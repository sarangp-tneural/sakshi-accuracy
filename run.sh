#!/usr/bin/env bash
# One command to run everything: Postgres + Redis (docker), migrations, API, Celery worker, frontend.
set -euo pipefail
cd "$(dirname "$0")"

command -v ffmpeg >/dev/null || { echo "ffmpeg/ffprobe not found - install it first"; exit 1; }
docker compose up -d --wait
(cd backend && uv sync --quiet && uv run alembic upgrade head)
[ -d frontend/node_modules ] || (cd frontend && npm install)

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd backend && uv run uvicorn app.main:app --port 8000 --reload) & pids+=($!)
(cd backend && uv run celery -A app.worker.celery worker -l info -c 2) & pids+=($!)
(cd frontend && npm run dev -- --host) & pids+=($!)

echo
echo "App:  http://localhost:5173"
echo "Create a user first:  uv run --project backend python scripts/create_user.py you@example.com 'password'"
wait
