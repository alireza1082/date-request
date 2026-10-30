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


MIN_MOOD_ACTIVITIES = 2
MAX_MOOD_ACTIVITIES = 10


def validate_wheel_configuration(activities: list[dict]) -> None:
    for mood in ('surprise', 'calm', 'outdoor'):
        count = sum(mood in activity['moods'] for activity in activities)
        if not MIN_MOOD_ACTIVITIES <= count <= MAX_MOOD_ACTIVITIES:
            raise ValueError('Each mood must contain between 2 and 10 active activities.')
