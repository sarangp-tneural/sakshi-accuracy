# Sakshi Verify — manual footfall counting vs Sakshi (MVP)

Add a video (upload or RTSP recording), count people in/out with the keyboard, enter Sakshi's numbers, compare, export.
No AI/detection in this MVP — everything is manual.

## Run everything (one command)

Requires: docker, `uv`, Node 20+, `ffmpeg` + `ffprobe`.

```bash
./run.sh
# in another terminal, create a login:
uv run --project backend python scripts/create_user.py you@example.com 'your-password'
```
Open http://localhost:5173. `run.sh` starts Postgres (port 5442) and Redis (6390) via Docker Compose, applies migrations,
then runs the API (:8000), a Celery worker and the Vite dev server. Videos are stored in `./data`.
Config via env vars or `.env` (`SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, `DATA_DIR`, `MAX_UPLOAD_BYTES`). **Set `SECRET_KEY` outside dev** — it signs tokens and encrypts RTSP links.

## Tests
```bash
cd backend && uv run pytest        # needs Postgres from docker compose (uses a separate sakshi_test DB)
cd frontend && npm test
```

## Where things are
Projects → a project has two tabs: **Videos** (upload, RTSP, list) and **Settings** (shortcuts, reaction delay, sound, slow-after-jump). Settings belong to your account, so they apply to every project. On the Count screen the **⚙ Settings** button opens the same panel as a drawer without touching the video position.

## Default keys (all changeable in Settings ⚙)
Left hand = male, right hand = female; index = IN, middle = OUT.
`F` male IN · `D` male OUT · `J` female IN · `K` female OUT · `G` IN (unknown) · `H` OUT (unknown) ·
`Space` play/pause · `Z` undo · `X` back 3 s · `1–4` speed · `←/→` frame step.
Mark time = video time − reaction delay × speed (default delay 0.4 s).

## How to test with a real video
1. Log in, create a project, **Upload video** (MP4/AVI/MOV). Status goes `processing` → `ready` (a browser-playable H.264 copy is made; the original is never modified).
2. Open it, play at 4x, count with the keys, try Undo, click a mark to jump, edit/delete a mark.
3. Settings: rebind a key (try one already used → Swap/Cancel), reload, confirm it persisted.
4. Enter Sakshi's numbers (leave one blank = "not entered", enter 0 = zero), check the comparison, export CSV / Excel.

## How to test with a real RTSP stream
Real camera: **RTSP record**, enter `rtsp://user:pass@host:554/path` and minutes (1–120). Status: `recording` → `ready` (saved), `partial` (stream dropped; partial video kept, reason shown) or `failed`.
Use **Preview camera** to see a still frame (optionally auto-refreshing every 3 s) before you start. While recording, the row shows **■ Stop**: it ends the recording early and keeps what was recorded.
The password is stored encrypted and is never returned or logged (only `rtsp://***:***@host/path`).

No camera? Fake one locally:
```bash
docker run --rm -p 8554:8554 bluenviron/mediamtx
ffmpeg -re -stream_loop -1 -i some.mp4 -c copy -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/live
# record rtsp://127.0.0.1:8554/live for 1 minute; stop the ffmpeg publisher after ~20 s to see "partial".
```
