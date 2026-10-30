"""Public seasonal configuration and protected updates."""
import re
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from api.auth import require_admin, require_admin_mutation


class SeasonalSettings(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    halloween_enabled: bool
    halloween_title: Annotated[str, Field(min_length=1, max_length=80)]
    halloween_subtitle: Annotated[str, Field(min_length=1, max_length=240)]
    halloween_cta: Annotated[str, Field(min_length=1, max_length=60)]
    halloween_note: Annotated[str, Field(max_length=160)]

    @field_validator('halloween_title', 'halloween_subtitle', 'halloween_cta', 'halloween_note')
    @classmethod
    def plain_text(cls, value, info):
        try:
            value.encode('utf-8')
        except UnicodeError:
            raise ValueError('Invalid text encoding') from None
        if re.search(r'[<>\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]', value) or re.search(r'(?:[a-z][a-z0-9+.-]*://|www\.|javascript:|data:)', value, re.I):
            raise ValueError('Use plain text without links')
        value = value.strip()
        if not value and info.field_name != 'halloween_note':
            raise ValueError('Text is required')
        return value


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    halloween_enabled: bool | None = None
    halloween_title: str | None = None
    halloween_subtitle: str | None = None
    halloween_cta: str | None = None
    halloween_note: str | None = None

    @model_validator(mode='before')
    @classmethod
    def require_values(cls, value):
        if not isinstance(value, dict) or not value or any(item is None for item in value.values()):
            raise ValueError('Supply at least one non-null field')
        return value


def read_settings(database):
    rows = dict(database.execute("SELECT key, value FROM settings WHERE key IN ('halloween_enabled','halloween_title','halloween_subtitle','halloween_cta','halloween_note')").fetchall())
    result = rows
    if result.get('halloween_enabled') in ('true', 'false'):
        result['halloween_enabled'] = result['halloween_enabled'] == 'true'
    return SeasonalSettings.model_validate(result)


def install_settings_routes(app):
    router = APIRouter()

    @router.get('/api/settings', response_model=SeasonalSettings)
    async def public_settings(request: Request):
        try:
            return read_settings(request.app.state.database)
        except (sqlite3.Error, ValidationError):
            raise HTTPException(503, 'Settings are unavailable.') from None

    @router.get('/api/admin/settings', response_model=SeasonalSettings, dependencies=[Depends(require_admin)])
    async def admin_settings(request: Request):
        try:
            return read_settings(request.app.state.database)
        except (sqlite3.Error, ValidationError):
            raise HTTPException(503, 'Settings are unavailable.') from None

    @router.patch('/api/admin/settings', response_model=SeasonalSettings, dependencies=[Depends(require_admin_mutation)])
    async def update_settings(data: SettingsPatch, request: Request):
        database = request.app.state.database
        try:
            with database:
                database.execute('BEGIN IMMEDIATE')
                merged = {**read_settings(database).model_dump(), **data.model_dump(exclude_unset=True)}
                try:
                    settings = SeasonalSettings.model_validate(merged)
                except ValidationError:
                    raise HTTPException(422, 'Invalid settings request.') from None
                values = settings.model_dump()
                database.executemany('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [(key, str(value).lower() if isinstance(value, bool) else value) for key, value in values.items()])
            return settings
        except (sqlite3.Error, ValidationError):
            raise HTTPException(503, 'Settings are unavailable.') from None

    app.include_router(router)
