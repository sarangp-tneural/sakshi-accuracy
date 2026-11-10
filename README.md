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

## Projects page
Each project is a card showing its videos, cameras, marks (IN / OUT), total video time, what is recording / processing / failed right now, how many videos are compared with Sakshi (with a progress bar) and when it was last active. The most recently active project is first. `GET /api/projects` returns these totals (a fixed number of queries however many projects there are).

## Saved cameras (one-click recording)
For accuracy checks you record from the same RTSP link again and again, so save it once per project. On a project's **Videos** tab, **+ Add camera** stores a name, the link and a default length. Each camera is a card with **● Start recording · 30 min**: one click records with the saved length (the length picker beside it changes it for that run only; **⋯ › Edit** changes the default). While it records the card shows elapsed / total and **Stop**; a camera that is already recording cannot be started twice. **⋯** also has Preview (a still frame) and Delete (recordings already made are kept). The one-off **Record from camera** dialog has a "Save as a camera for this project" option.

The link is stored encrypted and is never sent back to the browser (only `rtsp://***:***@host/path`); editing a camera keeps the saved link unless you choose **Change link**. Videos show which camera they came from. **Keep `SECRET_KEY` stable:** it encrypts the saved links, so if it ever changes the app tells you to re-enter each link (it also signs logins).

API: `GET/POST /api/projects/{id}/cameras`, `PATCH/DELETE /api/cameras/{id}`, `POST /api/cameras/{id}/record` (`{minutes?}`), `POST /api/cameras/{id}/preview`. Run `alembic upgrade head` (or `./run.sh`) to add the cameras table.

## Videos screen
A project's **Videos** tab is a table (one row per video). **+ Upload video** and **● Record from camera** (top right) open dialogs; you can also **drag files anywhere on the page** to upload (progress shows as a row at the top of the list, so nothing blocks you).

Columns: name, source, status (Recording shows elapsed / total and a Stop button), duration, marks (IN / OUT), gender (M / F / ?), Sakshi entered or not, added. **Count** opens the video; Export and Delete are under **⋯** (Delete says which marks and Sakshi result go with it). Click a row to open it, or the ▸ to expand the details (RTSP stream, requested / started / ended, recorded vs planned, video info, file size, why a recording is partial or failed).

Search by name, filter by status (chips with counts), source, progress (not started / counting / compared) and date added, and sort. Everything is in the URL, so a refresh or a shared link keeps it. Lists are paged (25 per page). The page only polls the server while something is recording or processing.

`GET /api/projects/{id}/videos` takes `q, status (repeatable), source, progress, added_from, added_to, sort (newest|oldest|name|duration), page, page_size` and returns `{items, total, page, page_size, status_counts, busy}`; invalid values get a 422.

Videos created before file size / resolution were stored show "—" there. Fill them in from the files on disk (dry run first, then `--apply`):
`uv run --project backend python scripts/backfill_video_details.py`. Start and end times of old recordings cannot be recovered.

## Player (review-style controls)
- **Timeline** (under the video): drag to scrub, click a marker to select it, **Ctrl + wheel** zooms, **Shift + wheel** pans, `− + ⤢` buttons. IN markers on the upper row, OUT on the lower; the ring colour is the gender; a diamond means the mark has a point.
- **Picture zoom:** Ctrl + wheel on the video (up to 8x), drag to pan, **Reset** in the badge.
- **Points:** on a mark use 📍 to pause on its frame, then click where the person is (Esc cancels). Points are saved with the mark (`x`, `y` as 0..1 of the picture), drawn on the video near the playhead, and exported to CSV/Excel. Toggle with **📍 Points**.
- **▶ on a mark** replays 2 s before to 2 s after. **go to 1:23** jumps to a time. Left/Right (and the step buttons) move as many frames as the playback speed: 1x = 1 frame, 2x = 2, 3x = 3, 4x = 4. After clicking the timeline the arrows work straight away, and holding a key keeps stepping (one seek at a time, so every shown frame is a real step). The step uses the measured frame gap and always lands on an exact frame.

**Smooth frame stepping needs frequent keyframes.** New uploads and recordings get a playback copy with a keyframe about every second (a plain copy is kept only when the source already has that). For videos processed earlier, rebuild their playback copy once (originals are never touched):
`uv run --project backend python scripts/reprocess_playback.py --all --dry-run` to see them, then without `--dry-run` (or pass video ids).

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
