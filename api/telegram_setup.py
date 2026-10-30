"""Opt-in owner setup helper. Prints private chat IDs only, never tokens or message text."""
import os
import sys
import httpx


def main():
    token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    if not token:
        print('Configure TELEGRAM_BOT_TOKEN in the backend environment first.')
        return 1
    try:
        response = httpx.get(f'https://api.telegram.org/bot{token}/getUpdates', timeout=8, trust_env=False)
        response.raise_for_status()
        result = response.json()
        if result.get('ok') is not True:
            raise ValueError()
        ids = {str(update['message']['chat']['id']) for update in result['result']
               if update.get('message', {}).get('chat', {}).get('type') == 'private'}
        print('\n'.join(sorted(ids)) if ids else 'No private chat found. Send /start to your new bot and retry.')
        return 0
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        print('Could not read Telegram updates. Check backend configuration and connectivity.')
        return 1


if __name__ == '__main__':
    sys.exit(main())
