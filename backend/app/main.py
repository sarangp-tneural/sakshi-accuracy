from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import auth, cameras, dashboard, export, marking_types, marks, projects, sakshi, settings as settings_router, videos

app = FastAPI(title="Sakshi Verify")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["Content-Disposition"])
for r in (auth, dashboard, projects, cameras, videos, marks, marking_types, sakshi, settings_router, export):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True}
