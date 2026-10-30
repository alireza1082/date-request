"""Privacy-conscious, explicitly consented spin history."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import re
import sqlite3
from typing import Annotated, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.auth import require_admin, require_admin_mutation

MAX_PAGE_SIZE = 100
MAX_OFFSET = 1_000_000
MAX_HISTORY_EVENTS = 50_000
ALLOWED_MOODS = {'surprise', 'calm', 'outdoor'}
EVENT_KEY = re.compile(r'^[A-Za-z0-9_-]{43}$')
EVENT_ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
PLAIN_TEXT = re.compile(r'[<>\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]')


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp(value: datetime | None = None) -> str:
    instant = (value or utc_now()).astimezone(timezone.utc)
    return instant.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def capability_digest(value: str) -> str:
    return hashlib.sha256(value.encode('ascii')).hexdigest()


class SpinSubmission(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, hide_input_in_errors=True)
    event_id: str = Field(pattern=EVENT_ID.pattern)
    event_key: str = Field(pattern=EVENT_KEY.pattern)
    consent: Literal[True]
    activity_id: str = Field(min_length=1, max_length=32, pattern=r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
    activity_title: str = Field(min_length=1, max_length=80)
    mood_id: Literal['surprise', 'calm', 'outdoor']
    display_name: str | None = Field(default=None, max_length=32)
    invitation_used: bool
    invitation_title: str = Field(default='', max_length=52)

    @field_validator('activity_title', 'display_name', 'invitation_title')
    @classmethod
    def plain_text(cls, value, info):
        if value is None:
            return None
        try:
            value.encode('utf-8')
        except UnicodeError:
            raise ValueError('Invalid text encoding') from None
        if PLAIN_TEXT.search(value):
            raise ValueError('Use plain text')
        value = value.strip()
        if not value and info.field_name == 'activity_title':
            raise ValueError('Activity title is required')
        return None if value == '' and info.field_name == 'display_name' else value

    @model_validator(mode='after')
    def invitation_consistency(self):
        if not self.invitation_used and self.invitation_title:
            raise ValueError('Invitation title requires invitation context')
        if self.activity_title is None:
            raise ValueError('Activity title is required')
        return self


class ClearHistory(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    confirmation: Literal['CLEAR_HISTORY']


def payload_digest(data: SpinSubmission) -> str:
    fields = data.model_dump(exclude={'event_key'})
    encoded = json.dumps(fields, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def cleanup_expired(database: sqlite3.Connection, retention_days: int, now: datetime | None = None, limit: int = 500) -> int:
    cutoff = timestamp((now or utc_now()) - timedelta(days=retention_days))
    with database:
        cursor = database.execute('''DELETE FROM spins WHERE id IN (
            SELECT id FROM spins WHERE created_at < ? ORDER BY created_at LIMIT ?
        )''', (cutoff, limit))
    return cursor.rowcount


def _history_row(row):
    return {
        'event_id': row[0], 'created_at': row[1], 'display_name': row[2] or None,
        'mood_id': row[3], 'activity_id': row[4], 'activity_title': row[5],
        'invitation_used': bool(row[6]), 'invitation_title': row[7] or None,
        'telegram_status': row[8], 'telegram_accepted_at': row[9],
        'reported_by_visitor': True,
    }


def install_history_routes(app):
    router = APIRouter()

    @router.post('/api/history', status_code=202)
    async def submit_history(data: SpinSubmission, request: Request):
        database = request.app.state.database
        try:
            # IDs are reserved once created, including archived IDs. This admits
            # a short-lived in-progress wheel snapshot while rejecting unknown
            # client-invented activities. Client reports are not verified spins.
            exists = database.execute('SELECT 1 FROM activities WHERE id=?', (data.activity_id,)).fetchone()
            if not exists:
                raise HTTPException(422, 'The selected activity is not recognized.')
            digest = payload_digest(data)
            key_hash = capability_digest(data.event_key)
            created_at = timestamp()
            with database:
                database.execute('BEGIN IMMEDIATE')
                previous = database.execute('SELECT payload_hash, event_key_hash, created_at FROM spins WHERE id=?', (data.event_id,)).fetchone()
                if previous:
                    if previous[0] != digest or previous[1] != key_hash:
                        raise HTTPException(409, 'This event identifier was already used.')
                    return {'recorded': True, 'duplicate': True, 'created_at': previous[2]}
                count = database.execute('SELECT count(*) FROM spins').fetchone()[0]
                if count >= MAX_HISTORY_EVENTS:
                    raise HTTPException(503, 'History is temporarily at capacity.')
                # The database records a title snapshot supplied by the current
                # wheel state, not an independently verified result.
                database.execute('''INSERT INTO spins
                    (id, created_at, display_name, mood_id, activity_id, activity_title,
                     invitation_used, invitation_title, telegram_attempted, telegram_succeeded,
                     payload_hash, event_key_hash, telegram_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'not_sent')''',
                    (data.event_id, created_at, data.display_name or '', data.mood_id,
                     data.activity_id, data.activity_title, int(data.invitation_used),
                     data.invitation_title, digest, key_hash))
            return {'recorded': True, 'duplicate': False, 'created_at': created_at}
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'This event identifier was already used.') from None
        except sqlite3.Error:
            raise HTTPException(503, 'History is temporarily unavailable.') from None

    def date_filters(date_from: date | None, date_to: date | None):
        if date_from and date_to and date_from > date_to:
            raise HTTPException(422, 'Invalid date range.')
        clauses, values = [], []
        if date_from:
            clauses.append('created_at >= ?')
            values.append(timestamp(datetime.combine(date_from, datetime.min.time(), timezone.utc)))
        if date_to:
            clauses.append('created_at < ?')
            values.append(timestamp(datetime.combine(date_to + timedelta(days=1), datetime.min.time(), timezone.utc)))
        return clauses, values

    @router.get('/api/admin/history')
    async def list_history(
        request: Request,
        _admin: str = Depends(require_admin),
        page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 30,
        offset: Annotated[int, Query(ge=0, le=MAX_OFFSET)] = 0,
        date_from: date | None = None,
        date_to: date | None = None,
        mood_id: Literal['surprise', 'calm', 'outdoor'] | None = None,
        activity_id: Annotated[str | None, Query(max_length=32, pattern=r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')] = None,
        invitation_used: bool | None = None,
        telegram_status: Literal['not_sent', 'attempted', 'accepted', 'failed'] | None = None,
    ):
        clauses, values = date_filters(date_from, date_to)
        for condition, value in (('mood_id=?', mood_id), ('activity_id=?', activity_id),
                                 ('invitation_used=?', None if invitation_used is None else int(invitation_used)),
                                 ('telegram_status=?', telegram_status)):
            if value is not None:
                clauses.append(condition)
                values.append(value)
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        try:
            database = request.app.state.database
            total = database.execute('SELECT count(*) FROM spins' + where, values).fetchone()[0]
            rows = database.execute('''SELECT id, created_at, display_name, mood_id, activity_id,
                activity_title, invitation_used, invitation_title, telegram_status, telegram_accepted_at
                FROM spins''' + where + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
                [*values, page_size, offset]).fetchall()
            return {'items': [_history_row(row) for row in rows], 'total': total,
                    'page_size': page_size, 'offset': offset,
                    'reported_events': True, 'retention_days': request.app.state.history_retention_days}
        except sqlite3.Error:
            raise HTTPException(503, 'History is temporarily unavailable.') from None

    @router.get('/api/admin/history/stats')
    async def history_stats(request: Request, _admin: str = Depends(require_admin)):
        database = request.app.state.database
        now = utc_now()
        today_start = timestamp(datetime.combine(now.date(), datetime.min.time(), timezone.utc))
        week_start = timestamp(datetime.combine(now.date() - timedelta(days=6), datetime.min.time(), timezone.utc))
        try:
            total = database.execute('SELECT count(*) FROM spins').fetchone()[0]
            today = database.execute('SELECT count(*) FROM spins WHERE created_at >= ?', (today_start,)).fetchone()[0]
            week = database.execute('SELECT count(*) FROM spins WHERE created_at >= ?', (week_start,)).fetchone()[0]
            popular = database.execute('''SELECT activity_id, activity_title, count(*) AS n FROM spins
                GROUP BY activity_id, activity_title ORDER BY n DESC, activity_id LIMIT 5''').fetchall()
            moods = database.execute('SELECT mood_id, count(*) FROM spins GROUP BY mood_id').fetchall()
            invitations = database.execute('SELECT count(*) FROM spins WHERE invitation_used=1').fetchone()[0]
            telegram = dict(database.execute('SELECT telegram_status, count(*) FROM spins GROUP BY telegram_status').fetchall())
            return {
                'reported_events': True, 'timezone': 'UTC', 'retention_days': request.app.state.history_retention_days,
                'total_spins': total, 'today_spins': today, 'last_7_days': week,
                'most_selected': [{'activity_id': row[0], 'activity_title': row[1], 'count': row[2]} for row in popular],
                'mood_distribution': {mood: dict(moods).get(mood, 0) for mood in ('surprise', 'calm', 'outdoor')},
                'invitation_spins': invitations,
                'telegram': {key: telegram.get(key, 0) for key in ('not_sent', 'attempted', 'accepted', 'failed')},
            }
        except sqlite3.Error:
            raise HTTPException(503, 'History statistics are temporarily unavailable.') from None

    @router.delete('/api/admin/history')
    async def clear_history(data: ClearHistory, request: Request, _admin: str = Depends(require_admin_mutation)):
        try:
            with request.app.state.database:
                cursor = request.app.state.database.execute('DELETE FROM spins')
            return {'deleted': cursor.rowcount}
        except sqlite3.Error:
            raise HTTPException(503, 'History is temporarily unavailable.') from None

    app.include_router(router)
