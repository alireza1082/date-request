FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATABASE_PATH=/app/data/date-wheel.sqlite3
WORKDIR /app
COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt
COPY api/main.py api/telegram_setup.py api/storage.py api/catalog.py api/auth.py api/activities.py api/icons.py api/settings.py api/seasonal_defaults.py /app/api/
COPY src/data/catalog.json /app/src/data/catalog.json
RUN mkdir -p /app/data && chown 65534:65534 /app/data && chmod 700 /app/data
USER 65534:65534
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--no-server-header", "--no-proxy-headers", "--limit-concurrency", "32"]
