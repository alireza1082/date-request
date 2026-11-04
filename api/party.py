"""Persistent Party scenario library, fixed/random selection, and safe raster media."""
from __future__ import annotations

from datetime import datetime, timezone
from contextlib import contextmanager
from io import BytesIO
import re
import sqlite3
import warnings
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from api.auth import require_admin, require_admin_mutation

ScenarioId = Annotated[str, Field(min_length=1, max_length=40, pattern=r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')]
ARTWORK_KEYS = {'neon-night', 'private-cinema', 'karaoke', 'mystery-night', 'surprise-kitchen', 'game-night', 'dance-and-lights'}
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_SCENARIOS = 100
MAX_MEDIA_STORAGE = 64 * 1024 * 1024


class ScenarioFields(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: str = Field(min_length=1, max_length=80)
    headline: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=320)
    steps: list[str] = Field(min_length=3, max_length=5)
    alt: str = Field(min_length=8, max_length=200)
    artwork_key: str = 'dance-and-lights'
    enabled: bool = False
    sort_order: int | None = Field(default=None, ge=0, le=10000)

    @field_validator('title', 'headline', 'description', 'alt')
    @classmethod
    def safe_text(cls, value):
        return validate_plain_text(value, required=True)

    @field_validator('steps')
    @classmethod
    def safe_steps(cls, steps):
        return [validate_plain_text(step, required=True, maximum=180) for step in steps]

    @field_validator('artwork_key')
    @classmethod
    def approved_artwork(cls, value):
        if value not in ARTWORK_KEYS:
            raise ValueError('Unsupported bundled artwork.')
        return value


class CreateScenario(ScenarioFields):
    id: ScenarioId


class PatchScenario(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: str | None = Field(default=None, min_length=1, max_length=80)
    headline: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, min_length=1, max_length=320)
    steps: list[str] | None = Field(default=None, min_length=3, max_length=5)
    alt: str | None = Field(default=None, min_length=8, max_length=200)
    artwork_key: str | None = None
    enabled: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)

    @model_validator(mode='before')
    @classmethod
    def require_patch(cls, value):
        if not isinstance(value, dict) or not value or any(item is None for item in value.values()):
            raise ValueError('Supply at least one non-null field.')
        return value

    @field_validator('title', 'headline', 'description', 'alt')
    @classmethod
    def safe_patch_text(cls, value):
        return validate_plain_text(value, required=True)

    @field_validator('steps')
    @classmethod
    def safe_patch_steps(cls, steps):
        return [validate_plain_text(step, required=True, maximum=180) for step in steps]

    @field_validator('artwork_key')
    @classmethod
    def approved_patch_artwork(cls, value):
        if value not in ARTWORK_KEYS:
            raise ValueError('Unsupported bundled artwork.')
        return value


class Scenario(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str
    title: str
    headline: str
    description: str
    alt: str
    steps: list[str]
    artwork_key: str
    image_url: str | None
    enabled: bool
    sort_order: int
    archived: bool
    created_at: str
    updated_at: str


class PublicScenario(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str
    title: str
    headline: str
    description: str
    alt: str
    steps: list[str]
    artwork_key: str
    image_url: str | None


class PublicParty(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    selection_mode: Literal['random', 'fixed']
    scenarios: list[PublicScenario] = Field(min_length=1)


class ScenarioList(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    scenarios: list[Scenario]


class ReorderScenarios(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    ids: list[ScenarioId] = Field(min_length=1, max_length=100)

    @field_validator('ids')
    @classmethod
    def unique_ids(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Scenario IDs must be unique.')
        return value


class SelectionPatch(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    mode: Literal['random', 'fixed']
    fixed_scenario_id: ScenarioId | None = None

    @model_validator(mode='after')
    def coherent_target(self):
        if (self.mode == 'fixed') != (self.fixed_scenario_id is not None):
            raise ValueError('Fixed mode requires exactly one selected scenario.')
        return self


class SelectionState(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    mode: Literal['random', 'fixed']
    fixed_scenario_id: str | None
    scenarios: list[Scenario]


def validate_plain_text(value: str, *, required: bool, maximum: int = 320) -> str:
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise ValueError('Invalid text encoding.') from None
    value = value.strip()
    if len(value) > maximum or (required and not value):
        raise ValueError('Text length is invalid.')
    if re.search(r'[<>\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]', value):
        raise ValueError('Use plain text.')
    if re.search(r'(?:[a-z][a-z0-9+.-]*://|www\.|javascript:|data:)', value, re.I):
        raise ValueError('Links are not accepted.')
    return value


def _read_scenarios(database: sqlite3.Connection, *, public=False) -> list[dict]:
    conditions = 'WHERE s.archived=0 AND s.enabled=1' if public else 'WHERE s.archived=0'
    rows = database.execute(f'''SELECT s.id,s.title,s.headline,s.description,s.alt,s.artwork_key,
        s.media_id,s.enabled,s.sort_order,s.archived,s.created_at,s.updated_at,st.step_order,st.text
        FROM party_scenarios AS s LEFT JOIN party_scenario_steps AS st ON st.scenario_id=s.id
        {conditions} ORDER BY s.sort_order,s.id,st.step_order''').fetchall()
    scenarios: dict[str, dict] = {}
    for row in rows:
        scenario_id = row[0]
        if scenario_id not in scenarios:
            scenarios[scenario_id] = {
                'id': row[0], 'title': row[1], 'headline': row[2], 'description': row[3], 'alt': row[4],
                'artwork_key': row[5], 'image_url': f'/api/party/media/{row[6]}' if row[6] else None,
                'enabled': bool(row[7]), 'sort_order': row[8], 'archived': bool(row[9]),
                'created_at': row[10], 'updated_at': row[11], 'steps': [],
            }
        if row[13] is not None:
            scenarios[scenario_id]['steps'].append(row[13])
    result = list(scenarios.values())
    return result if public else [item for item in result if not item['archived']]


def _selection(database):
    rows = dict(database.execute("SELECT key,value FROM settings WHERE key IN ('party_selection_mode','party_fixed_scenario_id')").fetchall())
    mode = rows.get('party_selection_mode', 'random')
    fixed = rows.get('party_fixed_scenario_id', '') or None
    if mode not in ('random', 'fixed') or (mode == 'fixed' and not fixed):
        raise ValueError('Party selection settings are invalid.')
    return mode, fixed


def _validate_selection_target(database, mode, fixed_id):
    if mode == 'random':
        count = database.execute('SELECT count(*) FROM party_scenarios WHERE enabled=1 AND archived=0').fetchone()[0]
        if count < 1:
            raise HTTPException(409, 'حداقل یک سناریوی فعال برای انتخاب تصادفی لازم است.')
        return
    row = database.execute('SELECT 1 FROM party_scenarios WHERE id=? AND enabled=1 AND archived=0', (fixed_id,)).fetchone()
    if not row:
        raise HTTPException(409, 'سناریوی ثابت باید فعال و بایگانی‌نشده باشد.')


@contextmanager
def _mutation(database):
    try:
        with database:
            database.execute('BEGIN IMMEDIATE')
            yield
    except HTTPException:
        raise
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'سناریو با اطلاعات موجود تداخل دارد.') from None
    except sqlite3.Error:
        raise HTTPException(503, 'ذخیرهٔ سناریو موقتاً در دسترس نیست.') from None
    except ValueError:
        raise HTTPException(503, 'تنظیم سناریوها نیاز به بررسی دارد.') from None


def install_party_routes(app):
    router = APIRouter()

    @router.get('/api/party', response_model=PublicParty)
    async def public_party(request: Request):
        try:
            database = request.app.state.database
            mode, fixed_id = _selection(database)
            available = _read_scenarios(database, public=True)
            if mode == 'fixed':
                available = [item for item in available if item['id'] == fixed_id]
                if not available:
                    raise ValueError('Fixed Party scenario is no longer available.')
            if not available:
                raise ValueError('No active Party scenarios are available.')
            public_fields = ('id','title','headline','description','alt','steps','artwork_key','image_url')
            return {'selection_mode': mode, 'scenarios': [{key: item[key] for key in public_fields} for item in available]}
        except (sqlite3.Error, ValueError, ValidationError):
            raise HTTPException(503, 'سناریوهای شب دونفره فعلاً در دسترس نیستند.') from None

    @router.get('/api/party/media/{media_id}')
    async def public_media(media_id: str, request: Request):
        if not re.fullmatch(r'[a-f0-9-]{36}', media_id):
            raise HTTPException(404, 'Image not found.')
        try:
            row = request.app.state.database.execute('SELECT content FROM party_media WHERE id=?', (media_id,)).fetchone()
        except sqlite3.Error:
            raise HTTPException(503, 'Image is temporarily unavailable.') from None
        if not row:
            raise HTTPException(404, 'Image not found.')
        return Response(row[0], media_type='image/webp', headers={
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
        })

    @router.get('/api/admin/party/scenarios', response_model=ScenarioList, dependencies=[Depends(require_admin)])
    async def list_scenarios(request: Request):
        try:
            return {'scenarios': _read_scenarios(request.app.state.database)}
        except sqlite3.Error:
            raise HTTPException(503, 'فهرست سناریوها در دسترس نیست.') from None

    @router.post('/api/admin/party/scenarios', response_model=Scenario, status_code=201, dependencies=[Depends(require_admin_mutation)])
    async def create_scenario(data: CreateScenario, request: Request):
        database = request.app.state.database
        with _mutation(database):
            count = database.execute('SELECT count(*) FROM party_scenarios WHERE archived=0').fetchone()[0]
            if count >= MAX_SCENARIOS:
                raise HTTPException(409, 'حداکثر ۱۰۰ سناریو در کتابخانه نگهداری می‌شود.')
            order = data.sort_order
            if order is None:
                order = database.execute('SELECT coalesce(max(sort_order),-1)+1 FROM party_scenarios WHERE archived=0').fetchone()[0]
            now = datetime.now(timezone.utc).isoformat(timespec='seconds')
            database.execute('''INSERT INTO party_scenarios
                (id,title,headline,description,alt,artwork_key,enabled,sort_order,archived,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?, ?,0,?,?)''',
                (data.id,data.title,data.headline,data.description,data.alt,data.artwork_key,int(data.enabled),order,now,now))
            database.executemany('INSERT INTO party_scenario_steps VALUES (?,?,?)', [(data.id,index,step) for index,step in enumerate(data.steps)])
            mode, fixed = _selection(database)
            _validate_selection_target(database, mode, fixed)
            return next(item for item in _read_scenarios(database) if item['id'] == data.id)

    @router.post('/api/admin/party/scenarios/reorder', response_model=ScenarioList, dependencies=[Depends(require_admin_mutation)])
    async def reorder_scenarios(data: ReorderScenarios, request: Request):
        database = request.app.state.database
        with _mutation(database):
            current = {row[0] for row in database.execute('SELECT id FROM party_scenarios WHERE archived=0').fetchall()}
            if set(data.ids) != current:
                raise HTTPException(409, 'همهٔ سناریوهای بایگانی‌نشده را دقیقاً یک‌بار بفرستید.')
            database.executemany('UPDATE party_scenarios SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [(index, scenario_id) for index,scenario_id in enumerate(data.ids)])
            return {'scenarios': _read_scenarios(database)}

    @router.patch('/api/admin/party/scenarios/{scenario_id}', response_model=Scenario, dependencies=[Depends(require_admin_mutation)])
    async def patch_scenario(scenario_id: ScenarioId, data: PatchScenario, request: Request):
        database = request.app.state.database
        with _mutation(database):
            current = next((item for item in _read_scenarios(database) if item['id'] == scenario_id), None)
            if current is None:
                raise HTTPException(404, 'سناریو پیدا نشد.')
            merged = {key: current[key] for key in ('title','headline','description','steps','alt','artwork_key','enabled','sort_order')}
            merged.update(data.model_dump(exclude_unset=True))
            try:
                clean = ScenarioFields.model_validate(merged)
            except ValidationError:
                raise HTTPException(422, 'اطلاعات سناریو معتبر نیست.') from None
            mode, fixed = _selection(database)
            if clean.enabled is False and mode == 'fixed' and fixed == scenario_id:
                raise HTTPException(409, 'ابتدا انتخاب ثابت را تغییر دهید؛ این سناریو نتیجهٔ ثابت فعلی است.')
            database.execute('''UPDATE party_scenarios SET title=?,headline=?,description=?,alt=?,artwork_key=?,enabled=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?''',
                (clean.title,clean.headline,clean.description,clean.alt,clean.artwork_key,int(clean.enabled),clean.sort_order,scenario_id))
            if 'steps' in data.model_fields_set:
                database.execute('DELETE FROM party_scenario_steps WHERE scenario_id=?', (scenario_id,))
                database.executemany('INSERT INTO party_scenario_steps VALUES (?,?,?)', [(scenario_id,index,step) for index,step in enumerate(clean.steps)])
            _validate_selection_target(database, mode, fixed)
            return next(item for item in _read_scenarios(database) if item['id'] == scenario_id)

    @router.delete('/api/admin/party/scenarios/{scenario_id}', status_code=204, dependencies=[Depends(require_admin_mutation)])
    async def archive_scenario(scenario_id: ScenarioId, request: Request):
        database = request.app.state.database
        with _mutation(database):
            row = database.execute('SELECT id FROM party_scenarios WHERE id=? AND archived=0', (scenario_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'سناریو پیدا نشد.')
            mode, fixed = _selection(database)
            if mode == 'fixed' and fixed == scenario_id:
                raise HTTPException(409, 'ابتدا انتخاب ثابت را تغییر دهید؛ این سناریو قابل بایگانی نیست.')
            database.execute('UPDATE party_scenarios SET archived=1,enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=?', (scenario_id,))
            _validate_selection_target(database, mode, fixed)
        return Response(status_code=204)

    @router.get('/api/admin/party/selection', response_model=SelectionState, dependencies=[Depends(require_admin)])
    async def read_selection(request: Request):
        try:
            database = request.app.state.database
            mode, fixed = _selection(database)
            return {'mode': mode, 'fixed_scenario_id': fixed, 'scenarios': _read_scenarios(database)}
        except (sqlite3.Error, ValueError):
            raise HTTPException(503, 'تنظیم انتخاب سناریو در دسترس نیست.') from None

    @router.patch('/api/admin/party/selection', response_model=SelectionState, dependencies=[Depends(require_admin_mutation)])
    async def update_selection(data: SelectionPatch, request: Request):
        database = request.app.state.database
        with _mutation(database):
            _validate_selection_target(database, data.mode, data.fixed_scenario_id)
            database.executemany('''INSERT INTO settings(key,value) VALUES (?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value''', [
                ('party_selection_mode', data.mode),
                ('party_fixed_scenario_id', data.fixed_scenario_id or ''),
            ])
            return {'mode': data.mode, 'fixed_scenario_id': data.fixed_scenario_id, 'scenarios': _read_scenarios(database)}

    @router.post('/api/admin/party/scenarios/{scenario_id}/image', dependencies=[Depends(require_admin_mutation)])
    async def upload_image(scenario_id: ScenarioId, request: Request):
        database = request.app.state.database
        body = await request.body()
        if not body or len(body) > MAX_IMAGE_BYTES:
            raise HTTPException(413 if body else 422, 'تصویر خالی یا بزرگ‌تر از ۴ مگابایت است.')
        encoded = _decode_image(body)
        media_id = str(uuid4())
        with _mutation(database):
            row = database.execute('SELECT media_id FROM party_scenarios WHERE id=? AND archived=0', (scenario_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'سناریو پیدا نشد.')
            used = database.execute('SELECT coalesce(sum(length(content)),0) FROM party_media').fetchone()[0]
            # Keep superseded immutable media URLs available for old visitor
            # snapshots. Reclaim only sufficiently old orphans when quota needs it.
            if used + len(encoded) > MAX_MEDIA_STORAGE:
                database.execute("""DELETE FROM party_media
                    WHERE datetime(created_at) < datetime('now','-30 days')
                    AND NOT EXISTS (SELECT 1 FROM party_scenarios WHERE media_id=party_media.id)""")
                used = database.execute('SELECT coalesce(sum(length(content)),0) FROM party_media').fetchone()[0]
            if used + len(encoded) > MAX_MEDIA_STORAGE:
                raise HTTPException(409, 'فضای تصویرهای سناریو به سقف مجاز رسیده است.')
            database.execute('INSERT INTO party_media(id,content,created_at) VALUES (?,?,?)', (media_id,encoded,datetime.now(timezone.utc).isoformat(timespec='seconds')))
            database.execute('UPDATE party_scenarios SET media_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (media_id,scenario_id))
            return next(item for item in _read_scenarios(database) if item['id'] == scenario_id)

    app.include_router(router)


def _decode_image(data: bytes) -> bytes:
    """Verify and re-encode a bounded JPEG/PNG/WebP into metadata-free WebP."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise HTTPException(503, 'پردازش تصویر موقتاً در دسترس نیست.') from None
    try:
        Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise ValueError('format')
                if source.width * source.height > MAX_IMAGE_PIXELS or max(source.size) > 6000:
                    raise ValueError('dimensions')
                source.verify()
            with Image.open(BytesIO(data)) as decoded:
                decoded.load()
                oriented = ImageOps.exif_transpose(decoded)
                has_alpha = 'A' in oriented.getbands() or 'transparency' in oriented.info
                clean = oriented.convert('RGBA' if has_alpha else 'RGB')
                clean.thumbnail((1800, 1400), Image.Resampling.LANCZOS)
                output = BytesIO()
                clean.save(output, format='WEBP', quality=84, method=4)
                value = output.getvalue()
                if not value or len(value) > 3 * 1024 * 1024:
                    raise ValueError('output')
                return value
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, 'فایل باید تصویر سالم JPEG، PNG یا WebP با ابعاد مجاز باشد.') from None
