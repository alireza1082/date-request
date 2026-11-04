"""Public seasonal configuration and protected updates."""
import re
import sqlite3
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from api.auth import require_admin, require_admin_mutation


class SeasonalSettings(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    halloween_enabled: bool
    party_enabled: bool
    mode_version: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def exclusive_modes(self):
        if self.party_enabled and self.halloween_enabled:
            raise ValueError("Only one special mode may be active")
        return self
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
    party_enabled: bool | None = None
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


class EffectiveModeMutation(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    mode: Literal['normal', 'halloween', 'party']
    expected_version: Annotated[int, Field(ge=0)]


class EffectiveModeState(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    mode: Literal['normal', 'halloween', 'party']
    halloween_enabled: bool
    party_enabled: bool
    mode_version: Annotated[int, Field(ge=0)]


def read_settings(database):
    rows = dict(database.execute("SELECT key, value FROM settings WHERE key IN ('party_enabled','halloween_enabled','halloween_title','halloween_subtitle','halloween_cta','halloween_note','mode_version')").fetchall())
    result = rows
    for key in ('party_enabled', 'halloween_enabled'):
        if result.get(key) in ('true', 'false'):
            result[key] = result[key] == 'true'
    if 'mode_version' in result:
        try:
            result['mode_version'] = int(result['mode_version'])
        except ValueError:
            pass
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
                patch = data.model_dump(exclude_unset=True)
                if patch.get('party_enabled') and patch.get('halloween_enabled'):
                    raise HTTPException(422, 'Choose one special mode.')
                if patch.get('party_enabled'):
                    patch['halloween_enabled'] = False
                if patch.get('halloween_enabled'):
                    patch['party_enabled'] = False
                merged = {**read_settings(database).model_dump(), **patch}
                try:
                    settings = SeasonalSettings.model_validate(merged)
                except ValidationError:
                    raise HTTPException(422, 'Invalid settings request.') from None
                values = settings.model_dump()
                if {'party_enabled', 'halloween_enabled'} & patch.keys():
                    values['mode_version'] = settings.mode_version + 1
                    settings = settings.model_copy(update={'mode_version': settings.mode_version + 1})
                database.executemany('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [(key, str(value).lower() if isinstance(value, bool) else value) for key, value in values.items()])
            return settings
        except (sqlite3.Error, ValidationError):
            raise HTTPException(503, 'Settings are unavailable.') from None

    @router.patch('/api/admin/mode', response_model=EffectiveModeState, dependencies=[Depends(require_admin_mutation)])
    async def update_mode(data: EffectiveModeMutation, request: Request):
        database = request.app.state.database
        try:
            with database:
                database.execute('BEGIN IMMEDIATE')
                current = read_settings(database)
                if data.expected_version != current.mode_version:
                    raise HTTPException(409, 'The public mode changed in another session. Reload the confirmed mode and try again.')
                halloween = data.mode == 'halloween'
                party = data.mode == 'party'
                version = current.mode_version + 1
                database.executemany('''INSERT INTO settings(key,value) VALUES (?,?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value''', [
                    ('halloween_enabled', str(halloween).lower()),
                    ('party_enabled', str(party).lower()),
                    ('mode_version', str(version)),
                ])
            return EffectiveModeState(mode=data.mode, halloween_enabled=halloween, party_enabled=party, mode_version=version)
        except HTTPException:
            raise
        except (sqlite3.Error, ValidationError):
            raise HTTPException(503, 'Settings are unavailable.') from None

    app.include_router(router)
