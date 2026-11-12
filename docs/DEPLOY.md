# Deploying Sakshi Verify on the E2E server

Server: `216.48.183.100` (Ubuntu, user `sarang`, app in `/opt/sakshi-verify`).
Current state: served over plain HTTP on port 80 (no domain / HTTPS yet).

## How it fits together

| Piece | What it does | Runs as |
|---|---|---|
| Postgres | Users, projects, marks, results | Docker (`docker compose`) |
| Redis | Queue between API and worker | Docker (`docker compose`) |
| API (uvicorn, :8000, localhost only) | Backend: logins, uploads, counting | systemd `sakshi-api` |
| Worker (Celery) | RTSP recording, ffmpeg playable copies | systemd `sakshi-worker` |
| nginx (:80) | Serves the built frontend, forwards `/api/` to the API | system service |

Videos are stored in `DATA_DIR` (`/opt/sakshi-verify/data`), twice per video (original + playable copy). Watch the disk.

---

## Part 1: First-time setup

### 1. Server and firewall
Create an Ubuntu 22.04/24.04 node (4 vCPU / 8 GB RAM or more, large disk). In the E2E security group allow inbound TCP **22, 80** (and **443** once HTTPS is set up). Keep Postgres (5442) and Redis (6390) closed.

### 2. Install software
```bash
sudo apt update
sudo apt install -y ffmpeg nginx git curl docker.io docker-compose-v2 certbot python3-certbot-nginx
curl -LsSf https://astral.sh/uv/install.sh | sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
source ~/.bashrc
```
ffmpeg records streams and makes playable copies; docker runs Postgres/Redis; uv installs the backend; node builds the frontend.

### 3. Let your user use Docker
```bash
sudo usermod -aG docker $USER
newgrp docker            # or log out and back in
docker ps                # must print a table, not "permission denied"
```

### 4. Get the code
```bash
sudo mkdir -p /opt/sakshi-verify && sudo chown $USER:$USER /opt/sakshi-verify
git clone <repo-url> /opt/sakshi-verify
cd /opt/sakshi-verify
```

### 5. Settings (`.env`)
```bash
nano /opt/sakshi-verify/.env
```
```
SECRET_KEY=<output of: openssl rand -hex 32>
DATA_DIR=/opt/sakshi-verify/data
DATABASE_URL=postgresql+psycopg://sakshi:<DB_PASSWORD>@localhost:5442/sakshi
CORS_ORIGINS=["http://216.48.183.100"]
```
- `SECRET_KEY` signs logins and encrypts saved camera links. **Generate once, never change it** (saved RTSP links become unreadable).
- `<DB_PASSWORD>`: letters and digits only (`openssl rand -hex 16`); `@ / #` break the URL.
- With a domain later, use `CORS_ORIGINS=["https://your-domain.com"]`.

### 6. Lock down the database (`docker-compose.yml`)
On the server, edit `docker-compose.yml`:
```yaml
      POSTGRES_PASSWORD: <DB_PASSWORD>          # was: sakshi
    ports: ["127.0.0.1:5442:5432"]              # postgres, was: ["5442:5432"]
    ports: ["127.0.0.1:6390:6379"]              # redis, was: ["6390:6379"]
```
Postgres only applies the password on first start. If the `pgdata` volume already exists, run `docker compose down -v` first (this **deletes the database**).
Note: local edits to this file will conflict with `git pull`; see "Updating" below.

### 7. Start Postgres and Redis
```bash
cd /opt/sakshi-verify
docker compose up -d --wait
```

### 8. Backend: install and create tables
```bash
cd /opt/sakshi-verify/backend
uv sync
uv run alembic upgrade head
```

### 9. Frontend: build
```bash
cd /opt/sakshi-verify/frontend
npm ci
npm run build            # output: frontend/dist
```

### 10. Create your login
```bash
cd /opt/sakshi-verify
uv run --project backend python scripts/create_user.py you@example.com 'strong-password'
```

### 11. systemd services
Confirm uv's path with `which uv` (expected `/home/sarang/.local/bin/uv`). Files in `/etc` need `sudo tee`; a plain `>` redirect fails.

```bash
sudo tee /etc/systemd/system/sakshi-api.service > /dev/null <<'EOF'
[Unit]
Description=Sakshi Verify API
After=docker.service network.target

[Service]
User=sarang
WorkingDirectory=/opt/sakshi-verify/backend
ExecStart=/home/sarang/.local/bin/uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/sakshi-worker.service > /dev/null <<'EOF'
[Unit]
Description=Sakshi Verify recorder worker
After=docker.service network.target

[Service]
User=sarang
WorkingDirectory=/opt/sakshi-verify/backend
ExecStart=/home/sarang/.local/bin/uv run celery -A app.worker.celery worker -l info -c 4
Restart=always
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

sudo chown -R sarang:sarang /opt/sakshi-verify
sudo systemctl daemon-reload
sudo systemctl enable --now sakshi-api sakshi-worker
systemctl is-active sakshi-api sakshi-worker      # both: active
curl -s http://127.0.0.1:8000/docs | head -c 80   # HTML
```
`Restart=always` brings them back after a crash/reboot. `KillMode=control-group` makes stopping the worker also stop its ffmpeg children.

### 12. nginx
`server_name _;` matches any host (bare IP). With a domain, put it there instead.
```bash
sudo tee /etc/nginx/sites-available/sakshi > /dev/null <<'EOF'
server {
  listen 80;
  server_name _;
  client_max_body_size 5g;

  root /opt/sakshi-verify/frontend/dist;
  location / { try_files $uri /index.html; }

  location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
sudo ln -s /etc/nginx/sites-available/sakshi /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
nginx runs as `www-data`; `/opt`, `/opt/sakshi-verify` and `frontend/dist` must be world-readable/enterable (`drwxr-xr-x`).

### 13. Verify
On the server:
```bash
sudo ss -tlnp | grep -E ':80 |:8000 '       # nginx on 0.0.0.0:80, uvicorn on 127.0.0.1:8000
curl -I http://127.0.0.1/                   # 200
```
From your laptop (this tests the real firewall):
```bash
curl -I --max-time 5 http://216.48.183.100/
```
Then open `http://216.48.183.100`, log in, create a project, upload a short video (status `processing` -> `ready`), check playback and seeking.

### 14. RTSP cameras
The worker records **from the server**, so the server must reach the camera. For cameras on a private network/Tailscale, install Tailscale on the server (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`) and check `tailscale status`.

### 15. HTTPS (optional, needs a domain)
1. DNS A record: `your-domain.com` -> `216.48.183.100` (`dig +short your-domain.com`).
2. Set `server_name your-domain.com;` in the nginx file, `sudo nginx -t && sudo systemctl reload nginx`.
3. E2E security group: allow inbound TCP **443**.
4. `sudo certbot --nginx -d your-domain.com`
5. `.env`: `CORS_ORIGINS=["https://your-domain.com"]`, then `sudo systemctl restart sakshi-api`.

Certbot cannot issue a normal certificate for a bare IP. Without HTTPS, passwords and tokens travel unencrypted, so use it only for testing.

---

## Part 2: Updating after code changes

Run on the server. **Stop any running recording first** (use Stop in the app): restarting the worker orphans a recording in progress.

```bash
cd /opt/sakshi-verify
git pull
(cd backend && uv sync && uv run alembic upgrade head)   # new packages + DB migrations
(cd frontend && npm ci && npm run build)                  # rebuild the website
sudo systemctl restart sakshi-api sakshi-worker
```

What each line does:
- `git pull`: fetches the new code.
- `uv sync` + `alembic upgrade head`: installs new Python packages and applies new database tables/columns. Always run it; it does nothing if there are no migrations.
- `npm ci` + `npm run build`: rebuilds `frontend/dist`. nginx serves it immediately, so no nginx restart is needed. Users may need a hard refresh (Ctrl+Shift+R).
- `systemctl restart`: loads new backend code. Needed whenever anything under `backend/` changed. If only the frontend changed, the restart can be skipped.

Quick guide by change type:

| What changed | What to run |
|---|---|
| Frontend only | `git pull`, build frontend |
| Backend code only | `git pull`, `uv sync`, restart both services |
| New DB migration | `git pull`, `uv sync`, `alembic upgrade head`, restart both |
| `.env` | edit `.env`, restart both services |
| `docker-compose.yml` | `docker compose up -d` (recreates changed containers) |
| nginx config | `sudo nginx -t && sudo systemctl reload nginx` |

### `git pull` conflicts on docker-compose.yml
If you edited `docker-compose.yml` on the server (Step 6), `git pull` can refuse. Either run `git stash && git pull && git stash pop`, or keep the server settings in a separate untracked `docker-compose.override.yml` and leave the tracked file unchanged.

### Maintenance scripts from the README (run only when a release says so)
```bash
uv run --project backend python scripts/backfill_video_details.py            # dry run; add --apply to write
uv run --project backend python scripts/reprocess_playback.py --all --dry-run
```

---

## Part 3: Troubleshooting

```bash
systemctl status sakshi-api sakshi-worker --no-pager
journalctl -u sakshi-api -n 50 --no-pager          # API logs (add -f to follow)
journalctl -u sakshi-worker -n 50 --no-pager       # recorder logs
docker compose ps                                  # Postgres / Redis status
sudo tail -20 /var/log/nginx/error.log             # nginx errors
df -h /opt/sakshi-verify                           # disk space (videos are large)
```

| Symptom | Likely cause / fix |
|---|---|
| `permission denied ... docker.sock` | User not in `docker` group (Step 3) |
| `Permission denied` writing to `/etc/...` | Use `sudo tee`, not `>` |
| Login works but pages show errors / CORS in browser console | `CORS_ORIGINS` doesn't match the address in the browser; fix `.env`, restart API |
| nginx 403 | `www-data` cannot read `frontend/dist`; check directory permissions (Step 12) |
| nginx 502 | API not running: `systemctl status sakshi-api` |
| Upload fails on big files | `client_max_body_size` too small, or disk full |
| Recording stuck on "waiting for the recorder" | Worker down: `systemctl status sakshi-worker`; see README "If a recording misbehaves" |
| Camera unreachable | Server cannot reach it; check Tailscale / firewall |
| Saved camera links unreadable | `SECRET_KEY` was changed; re-enter the links |

## Backups
The database lives in the Docker volume `pgdata`; videos in `DATA_DIR`. Back up both:
```bash
docker compose exec -T postgres pg_dump -U sakshi sakshi > ~/sakshi-$(date +%F).sql
```
Keep a copy of `.env` (especially `SECRET_KEY`) somewhere safe.
