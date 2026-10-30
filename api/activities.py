"""Authenticated activity management. All configuration checks run before commit."""
from contextlib import contextmanager
import re
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from api.auth import require_admin, require_admin_mutation
from api.catalog import CatalogActivity, MoodId, validate_wheel_configuration
from api.icons import ICONS, ICON_EMOJI, COLOR_INK
from api.storage import list_activities, list_active_activities

ActivityId = Annotated[str, Field(min_length=1, max_length=32, pattern=r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')]
MAX_OPTIONS = 40  # non-archived, including disabled drafts; reorder fits 2 KB


class EditableActivity(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: str = Field(min_length=1, max_length=80)
    wheelLabel: str = Field(min_length=1, max_length=14)
    description: str = Field(min_length=1, max_length=240)
    suggestion: str = Field(min_length=1, max_length=160)
    icon: str
    color: str
    moods: list[MoodId] = Field(min_length=1, max_length=3)
    enabled: bool = True

    @field_validator('title', 'wheelLabel', 'description', 'suggestion')
    @classmethod
    def plain_text(cls, value):
        try:
            value.encode('utf-8')
        except UnicodeError:
            raise ValueError('Invalid text encoding') from None
        if not value.strip() or re.search(r'[<>\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]', value):
            raise ValueError('Use short plain text')
        return value.strip()

    @field_validator('icon')
    @classmethod
    def allowed_icon(cls, value):
        if value not in ICON_EMOJI:
            raise ValueError('Unsupported icon')
        return value

    @field_validator('color')
    @classmethod
    def allowed_color(cls, value):
        value = value.lower()
        if value not in COLOR_INK:
            raise ValueError('Unsupported color token')
        return value

    @field_validator('moods')
    @classmethod
    def unique_moods(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Duplicate mood membership')
        return value


class CreateActivity(EditableActivity):
    id: ActivityId
    sortOrder: int | None = Field(default=None, ge=0, le=10000)


class PatchActivity(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: str | None = None
    wheelLabel: str | None = None
    description: str | None = None
    suggestion: str | None = None
    icon: str | None = None
    color: str | None = None
    moods: list[MoodId] | None = None
    enabled: bool | None = None
    sortOrder: int | None = Field(default=None, ge=0, le=10000)
    archived: bool | None = None

    @model_validator(mode='before')
    @classmethod
    def nonempty_nonnull(cls, value):
        if not isinstance(value, dict) or not value or any(item is None for item in value.values()):
            raise ValueError('Supply at least one non-null field')
        return value


class AdminActivity(CatalogActivity):
    enabled: bool
    archived: bool


class ActivityList(BaseModel):
    activities: list[AdminActivity]


class ReorderActivities(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    ids: list[ActivityId] = Field(min_length=1, max_length=MAX_OPTIONS)

    @field_validator('ids')
    @classmethod
    def unique_ids(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Duplicate activity ID')
        return value


class Icon(BaseModel):
    id: str
    label: str
    category: str


class IconList(BaseModel):
    icons: list[Icon]


@contextmanager
def mutation(database):
    try:
        with database:
            database.execute('BEGIN IMMEDIATE')
            yield
            if database.execute('SELECT count(*) FROM activities WHERE archived=0').fetchone()[0] > MAX_OPTIONS:
                raise HTTPException(409, f'At most {MAX_OPTIONS} non-archived activities are allowed.')
            try:
                validate_wheel_configuration(list_active_activities(database))
            except ValueError as error:
                raise HTTPException(409, str(error)) from None
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'Activity conflicts with an existing record.') from None
    except sqlite3.Error:
        raise HTTPException(503, 'Activity storage is unavailable.') from None


def find_activity(database, activity_id):
    for activity in list_activities(database, include_inactive=True):
        if activity['id'] == activity_id:
            return activity
    raise HTTPException(404, 'Activity not found.')


def install_activity_routes(app):
    router = APIRouter(prefix='/api/admin')

    @router.get('/icons', response_model=IconList, dependencies=[Depends(require_admin)])
    async def icons():
        return {'icons': list(ICONS)}

    @router.get('/activities', response_model=ActivityList, dependencies=[Depends(require_admin)])
    async def activities(request: Request):
        try:
            return {'activities': list_activities(request.app.state.database, include_inactive=True)}
        except sqlite3.Error:
            raise HTTPException(503, 'Activity storage is unavailable.') from None

    @router.post('/activities', response_model=AdminActivity, status_code=201, dependencies=[Depends(require_admin_mutation)])
    async def create(data: CreateActivity, request: Request):
        database = request.app.state.database
        with mutation(database):
            order = data.sortOrder
            if order is None:
                order = database.execute('SELECT coalesce(max(sort_order), -1) + 1 FROM activities WHERE archived=0').fetchone()[0]
            if order > 10000:
                raise HTTPException(409, 'Reorder activities before appending beyond the sort order limit.')
            database.execute('''INSERT INTO activities
                (id, title, wheel_label, description, suggestion, icon, emoji, color, ink, enabled, sort_order, archived)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)''',
                (data.id, data.title, data.wheelLabel, data.description, data.suggestion, data.icon, ICON_EMOJI[data.icon], data.color, COLOR_INK[data.color], int(data.enabled), order))
            database.executemany('INSERT INTO activity_moods VALUES (?, ?)', [(data.id, mood) for mood in data.moods])
            result = find_activity(database, data.id)
        return result

    @router.post('/activities/reorder', response_model=ActivityList, dependencies=[Depends(require_admin_mutation)])
    async def reorder(data: ReorderActivities, request: Request):
        database = request.app.state.database
        with mutation(database):
            current = {row[0] for row in database.execute('SELECT id FROM activities WHERE archived=0')}
            if set(data.ids) != current:
                raise HTTPException(409, 'Supply every non-archived activity ID exactly once.')
            database.executemany('UPDATE activities SET sort_order=? WHERE id=?', [(index, activity_id) for index, activity_id in enumerate(data.ids)])
            result = list_activities(database, include_inactive=True)
        return {'activities': result}

    @router.get('/activities/{activity_id}', response_model=AdminActivity, dependencies=[Depends(require_admin)])
    async def read(activity_id: ActivityId, request: Request):
        try:
            return find_activity(request.app.state.database, activity_id)
        except sqlite3.Error:
            raise HTTPException(503, 'Activity storage is unavailable.') from None

    @router.patch('/activities/{activity_id}', response_model=AdminActivity, dependencies=[Depends(require_admin_mutation)])
    async def update(activity_id: ActivityId, data: PatchActivity, request: Request):
        database = request.app.state.database
        with mutation(database):
            existing = find_activity(database, activity_id)
            changes = data.model_dump(exclude_unset=True)
            merged = {**existing, **changes}
            # Validate the full editable record, including patched text limits.
            try:
                validated = EditableActivity.model_validate({key: merged[key] for key in EditableActivity.model_fields})
            except ValidationError:
                raise HTTPException(422, 'Invalid activity request.') from None
            if merged['archived'] and changes.get('enabled') is True:
                raise HTTPException(409, 'Restore an archived activity before enabling it.')
            enabled = validated.enabled and not merged['archived']
            database.execute('''UPDATE activities SET title=?, wheel_label=?, description=?, suggestion=?,
                icon=?, emoji=?, color=?, ink=?, enabled=?, sort_order=?, archived=? WHERE id=?''',
                (validated.title, validated.wheelLabel, validated.description, validated.suggestion, validated.icon,
                 ICON_EMOJI[validated.icon], validated.color, COLOR_INK[validated.color], int(enabled), merged['sortOrder'], int(merged['archived']), activity_id))
            database.execute('DELETE FROM activity_moods WHERE activity_id=?', (activity_id,))
            database.executemany('INSERT INTO activity_moods VALUES (?, ?)', [(activity_id, mood) for mood in validated.moods])
            result = find_activity(database, activity_id)
        return result

    @router.delete('/activities/{activity_id}', status_code=204, dependencies=[Depends(require_admin_mutation)])
    async def archive(activity_id: ActivityId, request: Request):
        database = request.app.state.database
        with mutation(database):
            find_activity(database, activity_id)
            database.execute('UPDATE activities SET archived=1, enabled=0 WHERE id=?', (activity_id,))
        return Response(status_code=204)

    app.include_router(router)
