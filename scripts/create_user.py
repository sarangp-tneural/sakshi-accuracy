"""Usage: uv run --project backend python scripts/create_user.py EMAIL PASSWORD"""
import sys

sys.path.insert(0, "backend")
from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402

email, password = sys.argv[1].lower(), sys.argv[2]
with SessionLocal() as db:
    u = db.scalar(select(User).where(User.email == email))
    if u:
        u.password_hash = hash_password(password)
        print("updated", email)
    else:
        db.add(User(email=email, password_hash=hash_password(password)))
        print("created", email)
    db.commit()
