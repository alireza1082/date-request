"""Public catalog response contract. No user or Telegram configuration fields."""
from typing import Literal

from pydantic import BaseModel, ConfigDict

MoodId = Literal['surprise', 'calm', 'outdoor']


class CatalogActivity(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str
    title: str
    wheelLabel: str
    description: str
    suggestion: str
    icon: str
    emoji: str
    color: str
    ink: Literal['light', 'dark']
    sortOrder: int
    moods: list[MoodId]


class CatalogMood(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: MoodId
    label: str
    note: str
    activities: list[str]


class CatalogResponse(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    activities: list[CatalogActivity]
    moods: list[CatalogMood]
