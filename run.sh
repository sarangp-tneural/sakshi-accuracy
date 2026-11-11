#!/usr/bin/env bash
# One command to run everything: Postgres + Redis (docker), migrations, API, Celery worker, frontend.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

command -v ffmpeg >/dev/null || { echo "ffmpeg/ffprobe not found - install it first"; exit 1; }

# A recording in progress belongs to the worker that started it. Restarting now would orphan it (it would stay
# "recording" forever), so stop it with the Stop button first, or run `FORCE=1 ./run.sh` to go ahead anyway.
if [ -z "${FORCE:-}" ] && pgrep -f "ffmpeg -y -nostdin -loglevel error -rtsp_transport tcp" >/dev/null 2>&1; then
  echo "A recording is in progress. Stop it in the app first (or run: FORCE=1 ./run.sh)."
  exit 1
fi

# A worker left over from an earlier run keeps reading the same queue with OLD code: it can pick up a recording
# and then ignore Stop and never report that it started. Make sure only the new worker will run.
stale="$(pgrep -f "$ROOT/backend/.venv/bin/celery -A app.worker.celery" || true)"
if [ -n "$stale" ]; then
  echo "Stopping leftover recorder worker(s) from an earlier run: $(echo $stale | tr '\n' ' ')"
  kill $stale 2>/dev/null || true
  sleep 2
  kill -9 $stale 2>/dev/null || true
fi

docker compose up -d --wait
(cd backend && uv sync --quiet && uv run alembic upgrade head)
[ -d frontend/node_modules ] || (cd frontend && npm install)

# Job control: every service below gets its own process group, so stopping it stops everything under it
# (uv -> celery -> pool processes -> ffmpeg). Killing only the top process used to leave workers behind.
# Each service is started with its input from /dev/null: a background job that reads the terminal is frozen by the
# operating system (that froze the playable-copy step once), and none of them needs the keyboard.
set -m
pids=()
cleanup() {
  trap - EXIT INT TERM
  for p in "${pids[@]}"; do kill -TERM -- "-$p" 2>/dev/null || true; done
  sleep 1
  for p in "${pids[@]}"; do kill -KILL -- "-$p" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

(cd backend && exec uv run uvicorn app.main:app --port 8000 --reload </dev/null) & pids+=($!)
(cd backend && exec uv run celery -A app.worker.celery worker -l info -c 4 </dev/null) & pids+=($!)
(cd frontend && exec npm run dev -- --host </dev/null) & pids+=($!)

echo
echo "App:  http://localhost:5173"
echo "Create a user first:  uv run --project backend python scripts/create_user.py you@example.com 'password'"
wait
