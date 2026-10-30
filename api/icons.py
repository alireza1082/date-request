"""IDs correspond to existing artworkById entries; no remote/uploaded artwork."""
import json

from api.storage import CATALOG_PATH

ICONS = (
    {'id': 'cafe', 'label': 'فنجان قهوه', 'category': 'خوراکی و کافه'},
    {'id': 'cinema', 'label': 'سینما', 'category': 'سرگرمی'},
    {'id': 'ice-cream', 'label': 'بستنی', 'category': 'خوراکی و کافه'},
    {'id': 'dinner', 'label': 'شام', 'category': 'خوراکی و کافه'},
    {'id': 'breakfast', 'label': 'صبحانه', 'category': 'خوراکی و کافه'},
    {'id': 'walk', 'label': 'قدم‌زدن', 'category': 'فضای باز'},
    {'id': 'picnic', 'label': 'سبد پیک‌نیک', 'category': 'فضای باز'},
    {'id': 'bookshop', 'label': 'کتاب', 'category': 'فرهنگ'},
    {'id': 'museum', 'label': 'موزه', 'category': 'فرهنگ'},
    {'id': 'bowling', 'label': 'بولینگ', 'category': 'سرگرمی'},
)
_BUILTIN = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
ICON_EMOJI = {item['id']: item['emoji'] for item in _BUILTIN['activities']}
COLOR_INK = {item['color']: item['ink'] for item in _BUILTIN['activities']}
