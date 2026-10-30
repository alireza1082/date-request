"""Single-admin sessions and CSRF. SQLite access stays on the API event loop."""
import asyncio
from dataclasses import dataclass, field
import hashlib
import hmac
import os
import re
import secrets
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

SESSION_SECONDS = 8 * 60 * 60
CHALLENGE_SECONDS = 300
TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{43}$')
SAFE_METHODS = {'GET', 'HEAD', 'OPTIONS'}


def digest(secret: bytes, purpose: str, value: str) -> str:
    return hmac.new(secret, f'{purpose}:{value}'.encode(), hashlib.sha256).hexdigest()


def password_key(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=3, maxmem=64 * 1024 * 1024)


@dataclass(repr=False)
class Credentials:
    secret: bytes = field(repr=False)
    salt: bytes = field(repr=False)
    password_hash: bytes = field(repr=False)
    version: str = field(repr=False)
    origin: str
    secure: bool

    @classmethod
    def from_environment(cls):
        password = os.getenv('ADMIN_PASSWORD', '')
        secret = os.getenv('ADMIN_SESSION_SECRET', '')
        origin = os.getenv('ADMIN_ORIGIN', '')
        try:
            parsed = urlsplit(origin)
            if not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                return None
            # Validate port syntax too. Trust configured origin, never forwarded headers.
            _ = parsed.port
        except ValueError:
            return None
        secure = parsed.scheme == 'https'
        if not secure and not (os.getenv('ADMIN_ALLOW_INSECURE_LOCAL') == 'true' and parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')):
            return None
        try:
            password.encode()
        except UnicodeError:
            return None
        categories = sum((any(c.islower() for c in password), any(c.isupper() for c in password), any(c.isdigit() for c in password), any(not c.isalnum() for c in password)))
        passphrase = len(password) >= 20 and len(password.split()) >= 4
        if not (14 <= len(password) <= 128 and len(password.encode()) <= 512 and len(set(password)) >= 8 and (categories >= 3 or passphrase)):
            return None
        if len(secret) < 43 or len(secret) > 256 or len(set(secret)) < 16 or not re.fullmatch(r'[A-Za-z0-9_-]+', secret):
            return None
        secret_bytes = secret.encode()
        salt = bytes.fromhex(digest(secret_bytes, 'password-salt', 'v1'))
        try:
            key = password_key(password, salt)
        except ValueError:
            return None
        version = digest(secret_bytes, 'credentials', key.hex())
        return cls(secret_bytes, salt, key, version, origin, secure)


class AdminAuth:
    def __init__(self, credentials, clock=time.time):
        self.credentials = credentials
        self.clock = clock
        self.verification_slot = asyncio.Semaphore(1)

    def configured(self) -> Credentials:
        if self.credentials is None:
            raise HTTPException(503, 'Admin authentication is unavailable.')
        return self.credentials

    @property
    def session_cookie(self):
        return '__Host-datewheel-admin' if self.configured().secure else 'datewheel_admin_local'

    @property
    def challenge_cookie(self):
        return '__Host-datewheel-login' if self.configured().secure else 'datewheel_login_local'

    def check_origin(self, request: Request, required=True):
        credentials = self.configured()
        origin = request.headers.get('origin')
        if request.headers.get('sec-fetch-site') == 'cross-site' or (required and origin is None) or (origin is not None and origin != credentials.origin):
            raise HTTPException(403, 'Request verification failed.')

    def session(self, request: Request) -> str:
        credentials = self.configured()
        token = request.cookies.get(self.session_cookie, '')
        if not TOKEN_PATTERN.fullmatch(token):
            raise HTTPException(401, 'Authentication required.')
        token_hash = digest(credentials.secret, 'session', token)
        database = request.app.state.database
        with database:
            database.execute('DELETE FROM admin_sessions WHERE expires_at <= ?', (int(self.clock()),))
        record = database.execute('SELECT credential_version FROM admin_sessions WHERE token_hash=?', (token_hash,)).fetchone()
        if not record or not hmac.compare_digest(record[0], credentials.version):
            raise HTTPException(401, 'Authentication required.')
        return token_hash

    def check_csrf(self, request: Request, token_hash: str):
        self.check_origin(request)
        expected = digest(self.configured().secret, 'session-csrf', token_hash)
        supplied = request.headers.get('x-csrf-token', '')
        if not re.fullmatch(r'[a-f0-9]{64}', supplied) or not hmac.compare_digest(expected, supplied):
            raise HTTPException(403, 'Request verification failed.')

    def login_budget(self, database):
        now = self.clock()
        with database:
            row = database.execute('SELECT remaining, updated_at FROM admin_login_budget WHERE id=1').fetchone()
            remaining = min(5.0, row[0] + max(0, now - row[1]) / 60) if row else 5.0
            permitted = remaining >= 1
            database.execute('INSERT OR REPLACE INTO admin_login_budget VALUES (1, ?, ?)', (remaining - 1 if permitted else remaining, now))
        if not permitted:
            raise HTTPException(429, 'Please try again later.', headers={'Retry-After': '60'})

    def login_csrf(self, request: Request):
        self.check_origin(request)
        challenge = request.cookies.get(self.challenge_cookie, '')
        try:
            if len(challenge) > 160:
                raise ValueError()
            nonce, issued, signature = challenge.split('.')
            timestamp = int(issued)
            expected = digest(self.configured().secret, 'login-cookie', f'{nonce}.{issued}')
            valid = TOKEN_PATTERN.fullmatch(nonce) and 0 <= self.clock() - timestamp < CHALLENGE_SECONDS and re.fullmatch(r'[a-f0-9]{64}', signature) and hmac.compare_digest(expected, signature)
        except (ValueError, TypeError):
            valid = False
        supplied = request.headers.get('x-csrf-token', '')
        if not valid or not re.fullmatch(r'[a-f0-9]{64}', supplied) or not hmac.compare_digest(digest(self.configured().secret, 'login-csrf', challenge), supplied):
            raise HTTPException(403, 'Request verification failed.')


async def require_admin(request: Request) -> str:
    """Use Depends(require_admin) for future read-only admin routes."""
    return request.app.state.admin_auth.session(request)


async def require_admin_mutation(request: Request) -> str:
    """Use Depends(require_admin_mutation) for future state-changing routes."""
    auth = request.app.state.admin_auth
    token_hash = auth.session(request)
    auth.check_csrf(request, token_hash)
    return token_hash


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, hide_input_in_errors=True)
    password: str = Field(min_length=1, max_length=128)

    @field_validator('password')
    @classmethod
    def utf8_password(cls, value):
        try:
            value.encode('utf-8')
        except UnicodeError:
            raise ValueError('Invalid password encoding') from None
        return value


def install_admin_auth(app):
    router = APIRouter(prefix='/api/admin/auth')

    @app.middleware('http')
    async def admin_security(request: Request, call_next):
        if not request.url.path.startswith('/api/admin/'):
            return await call_next(request)
        try:
            auth = request.app.state.admin_auth
            auth.configured()
            if request.method not in SAFE_METHODS:
                if request.url.path == '/api/admin/auth/login':
                    auth.login_budget(request.app.state.database)
                    auth.login_csrf(request)
                else:
                    await require_admin_mutation(request)
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > 2048:
                        raise HTTPException(413, 'Request too large.')
                    body.extend(chunk)
                request._body = bytes(body)
            response = await call_next(request)
        except HTTPException as error:
            response = JSONResponse({'detail': error.detail}, status_code=error.status_code, headers=error.headers)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Pragma'] = 'no-cache'
        return response

    @router.get('/csrf')
    async def csrf(request: Request, response: Response):
        auth = request.app.state.admin_auth
        auth.check_origin(request, required=False)
        try:
            token_hash = auth.session(request)
        except HTTPException as error:
            if error.status_code != 401:
                raise
            nonce = secrets.token_urlsafe(32)
            issued = str(int(auth.clock()))
            challenge = f'{nonce}.{issued}.{digest(auth.credentials.secret, "login-cookie", f"{nonce}.{issued}")}'
            response.set_cookie(auth.challenge_cookie, challenge, max_age=CHALLENGE_SECONDS, secure=auth.credentials.secure, httponly=True, samesite='strict', path='/')
            return {'csrf_token': digest(auth.credentials.secret, 'login-csrf', challenge)}
        return {'csrf_token': digest(auth.credentials.secret, 'session-csrf', token_hash)}

    @router.post('/login')
    async def login(data: LoginRequest, request: Request, response: Response):
        auth = request.app.state.admin_auth
        if auth.verification_slot.locked():
            raise HTTPException(429, 'Please try again later.', headers={'Retry-After': '60'})
        async with auth.verification_slot:
            candidate = await asyncio.to_thread(password_key, data.password, auth.credentials.salt)
        if not hmac.compare_digest(candidate, auth.credentials.password_hash):
            raise HTTPException(401, 'Authentication failed.')
        token = secrets.token_urlsafe(32)
        token_hash = digest(auth.credentials.secret, 'session', token)
        database = request.app.state.database
        now = int(auth.clock())
        with database:
            database.execute('DELETE FROM admin_sessions WHERE expires_at <= ? OR credential_version != ?', (now, auth.credentials.version))
            # Bound state to 32 active sessions; revoke the oldest before adding.
            database.execute('DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions ORDER BY created_at DESC, token_hash LIMIT -1 OFFSET 31)')
            old = request.cookies.get(auth.session_cookie, '')
            database.execute('DELETE FROM admin_sessions WHERE token_hash=?', (digest(auth.credentials.secret, 'session', old),))
            database.execute('INSERT INTO admin_sessions VALUES (?, ?, ?, ?)', (token_hash, auth.credentials.version, now, now + SESSION_SECONDS))
        response.set_cookie(auth.session_cookie, token, max_age=SESSION_SECONDS, secure=auth.credentials.secure, httponly=True, samesite='strict', path='/')
        response.delete_cookie(auth.challenge_cookie, path='/', secure=auth.credentials.secure, httponly=True, samesite='strict')
        return {'authenticated': True}

    @router.get('/me')
    async def me(_session: str = Depends(require_admin)):
        return {'authenticated': True}

    @router.post('/logout')
    async def logout(request: Request, response: Response, token_hash: str = Depends(require_admin_mutation)):
        auth = request.app.state.admin_auth
        with request.app.state.database:
            request.app.state.database.execute('DELETE FROM admin_sessions WHERE token_hash=?', (token_hash,))
        response.delete_cookie(auth.session_cookie, path='/', secure=auth.credentials.secure, httponly=True, samesite='strict')
        return {'authenticated': False}

    app.include_router(router)
