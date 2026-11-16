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

## If a recording misbehaves
- **Stuck on "waiting for the recorder…", or Stop does nothing:** an old Celery worker from an earlier run is still alive and reading the same queue with old code. `./run.sh` now stops any leftover worker of this project when it starts (and refuses to restart while a recording is running, unless you use `FORCE=1 ./run.sh`). Only one worker should exist: `pgrep -af "celery -A app.worker.celery"`.
- **A recording row that cannot be stopped:** this happens when the worker that owned it was restarted or crashed, so nothing is recording it any more. **Stop** now notices that and finishes the row on the spot (footage on disk is kept as a partial video, otherwise it is marked failed with the reason), and such a row can be deleted. A worker also tidies these up by itself a few seconds after it starts. A recording counts as alive while its recorder refreshes a heartbeat, or Celery shows it running or queued.
- **Start on a camera that is not reachable:** the recording shows **Attempting** (with the try number, how long, and why the last try failed) and keeps trying about every 10 s for **5 minutes** (`RTSP_ATTEMPT_WINDOW_S`, `RTSP_ATTEMPT_RETRY_S`, `RTSP_ATTEMPT_TRY_S`). If video arrives in that time, recording starts at that moment: **that moment is the start time**, and the length you picked counts from there. If it never comes, the row fails with how long it tried and no start time. **Cancel** ends the attempt.
- **The camera drops or goes silent while recording:** it stops there, keeps what was recorded as **partial**, and the **end time is the last moment video arrived** (not when it was noticed). It never reconnects by itself. A silent camera is noticed after 45 s without new video (`RTSP_STALL_S`) or sooner if the connection closes (`RTSP_IO_TIMEOUT_S`, 10 s). If the camera is on Tailscale, check `tailscale status` that it shows online.
- **After a recording ends the row says Processing** while the playable copy is made (the timer stops and the camera can be started again). That step never reads the terminal and has a time limit; if the conversion is too slow, a quick copy is saved instead and the row notes it.
- Reasons are plain sentences for the usual causes: unreachable, connection refused, wrong login, wrong path, unknown host.

## Saved cameras (one-click recording)
For accuracy checks you record from the same RTSP link again and again, so save it once per project. On a project's **Videos** tab, **+ Add camera** stores a name, the link and a default length. Each camera is a card with **● Start recording · 30 min**: one click records with the saved length (the length picker beside it changes it for that run only; **⋯ › Edit** changes the default). While it records the card shows elapsed / total and **Stop**; a camera that is already recording cannot be started twice. **⋯** also has Preview (a still frame) and Delete (recordings already made are kept). The one-off **Record from camera** dialog has a "Save as a camera for this project" option.

The link is stored encrypted and is never sent back to the browser (only `rtsp://***:***@host/path`); editing a camera keeps the saved link unless you choose **Change link**. Videos show which camera they came from. **Keep `SECRET_KEY` stable:** it encrypts the saved links, so if it ever changes the app tells you to re-enter each link (it also signs logins).

API: `GET/POST /api/projects/{id}/cameras`, `PATCH/DELETE /api/cameras/{id}`, `POST /api/cameras/{id}/record` (`{minutes?}`), `POST /api/cameras/{id}/preview`. Run `alembic upgrade head` (or `./run.sh`) to add the cameras table.

## RTSP relay (cameras ffmpeg can't log in to)
Some cameras use a digest login that ffmpeg can't do. The app therefore sends every RTSP recording and preview through a local **mediamtx** relay (started by `docker compose up -d`, listening on 127.0.0.1 only). You still just paste the normal `rtsp://user:pass@host/...` link: the backend registers it with the relay for the duration of the recording or preview (a one-off random path, removed afterwards; the password never appears in a path, URL, log or error) and records from the local copy. If the relay isn't running you get a clear message; set `RTSP_RELAY=false` to connect straight to cameras as before. Settings: `RTSP_RELAY_API` (default `http://127.0.0.1:9997`), `RTSP_RELAY_HOST`, `RTSP_RELAY_PORT`.

## Videos screen
A project's **Videos** tab is a table (one row per video). **+ Upload video** and **● Record from camera** (top right) open dialogs; you can also **drag files anywhere on the page** to upload (progress shows as a row at the top of the list, so nothing blocks you).

Columns: name, source, status (Recording shows elapsed / total and a Stop button), duration, marks (IN / OUT), Sakshi entered or not, added. **Count** opens the video; Export and Delete are under **⋯** (Delete says which marks and Sakshi result go with it). Click a row to open it, or the ▸ to expand the details (RTSP stream, requested / started / ended, recorded vs planned, video info, file size, why a recording is partial or failed).

Search by name, filter by status (chips with counts), source, progress (not started / counting / compared) and date added, and sort. Everything is in the URL, so a refresh or a shared link keeps it. Lists are paged (25 per page). The page only polls the server while something is recording or processing.

`GET /api/projects/{id}/videos` takes `q, status (repeatable), source, progress, added_from, added_to, sort (newest|oldest|name|duration), page, page_size` and returns `{items, total, page, page_size, status_counts, busy}`; invalid values get a 422.

Videos created before file size / resolution were stored show "—" there. Fill them in from the files on disk (dry run first, then `--apply`):
`uv run --project backend python scripts/backfill_video_details.py`. Start and end times of old recordings cannot be recovered.

## Freeing disk space (delete only the video file)
Each recording is stored twice (the original and the playable copy). On the Videos screen, a row's `⋯` menu has **Delete video file…**: it deletes just those files and keeps the row, marks and counts, the Sakshi result, the comparison, export and all details. It cannot be undone, and it is only offered for finished videos (Ready, Partial, Failed). Sort by **Largest file** to find what to delete. The Count screen of such a video shows a "Video not available" placeholder; existing marks can still be edited or deleted and the Sakshi result entered, but new marks cannot be added. The API is `DELETE /api/videos/{id}/file`; the full **Delete…** still removes everything. Apply the migration with `cd backend && uv run alembic upgrade head`.

## Player (review-style controls)
- **Timeline** (under the video): drag to scrub, click a marker to select it, **Ctrl + wheel** zooms, **Shift + wheel** pans, `− + ⤢` buttons. IN markers on the upper row, OUT on the lower, markings with no direction on a middle row that appears when you have some; the colour is the marking's colour; a diamond means the mark has a point.
- **Picture zoom:** Ctrl + wheel on the video (up to 8x), drag to pan, **Reset** in the badge.
- **Points:** on a mark use 📍 to pause on its frame, then click where the person is (Esc cancels). Points are saved with the mark (`x`, `y` as 0..1 of the picture), drawn on the video near the playhead, and exported to CSV/Excel. Toggle with **📍 Points**.
- **▶ on a mark** replays 2 s before to 2 s after. **go to 1:23** jumps to a time. Left/Right (and the step buttons) move as many frames as the playback speed: 1x = 1 frame, 2x = 2, 3x = 3, 4x = 4. After clicking the timeline the arrows work straight away, and holding a key keeps stepping (one seek at a time, so every shown frame is a real step). The step uses the measured frame gap and always lands on an exact frame.

**Smooth frame stepping needs frequent keyframes.** New uploads and recordings get a playback copy with a keyframe about every second (a plain copy is kept only when the source already has that). For videos processed earlier, rebuild their playback copy once (originals are never touched):
`uv run --project backend python scripts/reprocess_playback.py --all --dry-run` to see them, then without `--dry-run` (or pass video ids).

## Markings and keys
**What you count is set per project**, under the project's **Settings** tab (or **⚙ Settings** while counting). Each marking has a name, a colour, a key and a direction: **IN**, **OUT** or **no direction**. IN/OUT markings add to the IN/OUT totals; a marking with no direction, such as "Greeting", is counted on its own. Add one, rename it, change its key, reorder it or remove it. Removing a marking that already has marks keeps those marks with their name; its key is freed.
The **Sakshi result form is built from these markings** (one field per marking), and the comparison and exports list them too. Results entered before this existed keep their IN / OUT values (still compared) and are shown as a note.

New projects start with: `F` male IN · `D` male OUT · `J` female IN · `K` female OUT · `G` IN (unknown) · `H` OUT (unknown). These are ordinary markings and can be changed or removed.
Player keys (per account, changeable in Settings): `Space` play/pause · `Z` undo · `X` back 3 s · `1–4` speed · `←/→` frame step. A key can't be used twice, across markings and player keys.
Mark time = video time − reaction delay × speed (default delay 0.4 s).

## Accuracy report
Under the Sakshi comparison on the Count screen, **Accuracy report** gives precision, recall and gender accuracy. Actual = your IN + OUT, system = Sakshi's IN + OUT (both already in the tool). **You type TP**, the number of Sakshi counts that were real visitors; buttons set it for the two simple cases (**All system counts real**: TP = system, **Nothing missed**: TP = actual). Optional gender numbers (about the TPs only) give overall / male / female accuracy and gender coverage.
**Every marking gets the same report** (e.g. Greeting): the **By marking** table shows your count, Sakshi's count, a TP you type, and FP, FN, precision and recall for it. Markings with no direction don't count toward the IN + OUT footfall report.
Formulas: FP = system − TP · FN = actual − TP · over/under = system − actual · precision = TP / system · recall = TP / actual · gender accuracy = correct gender / TP · coverage = counts with a gender / system. A blank or undefined value shows "not entered", never 0.
The project's **Report** tab lists every video with totals (counts summed, then divided), and the CSV/Excel export has an Evaluation block. The maths lives in `backend/app/metrics.py`; TP is stored with `tp_source` (`manual` now) so timestamp matching can fill it later. Apply the migrations with `cd backend && uv run alembic upgrade head`.

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
