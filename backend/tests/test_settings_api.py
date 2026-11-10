from app import key_registry as kr


def body(**kw):
    b = {"reaction_delay_s": 0.4, "sound_enabled": True, "slow_after_jump": False,
         "key_bindings": dict(kr.DEFAULT_BINDINGS)}
    b.update(kw)
    return b


def test_defaults_on_first_read(client, auth):
    r = client.get("/api/settings", headers=auth).json()
    assert r["key_bindings"] == kr.DEFAULT_BINDINGS and r["reaction_delay_s"] == 0.4


def test_requires_auth(client):
    assert client.get("/api/settings").status_code == 401


def test_save_and_load(client, auth):
    kb = dict(kr.DEFAULT_BINDINGS, male_in="KeyQ")
    r = client.put("/api/settings", json=body(key_bindings=kb, reaction_delay_s=0.7, sound_enabled=False), headers=auth)
    assert r.status_code == 200
    got = client.get("/api/settings", headers=auth).json()
    assert got["key_bindings"]["male_in"] == "KeyQ" and got["reaction_delay_s"] == 0.7 and got["sound_enabled"] is False


def test_rejects_invalid(client, auth):
    kb = dict(kr.DEFAULT_BINDINGS, male_in="KeyD")
    assert client.put("/api/settings", json=body(key_bindings=kb), headers=auth).status_code == 422
    kb = dict(kr.DEFAULT_BINDINGS)
    del kb["undo"]
    assert client.put("/api/settings", json=body(key_bindings=kb), headers=auth).status_code == 422
    assert client.put("/api/settings", json=body(reaction_delay_s=-1), headers=auth).status_code == 422
    # nothing was saved
    assert client.get("/api/settings", headers=auth).json()["key_bindings"] == kr.DEFAULT_BINDINGS


def test_missing_action_in_saved_row_is_filled(client, auth):
    from app.db import SessionLocal
    from app.models import UserSettings
    client.get("/api/settings", headers=auth)
    with SessionLocal() as db:
        s = db.query(UserSettings).one()
        s.key_bindings = {"male_in": "KeyQ"}
        db.commit()
    got = client.get("/api/settings", headers=auth).json()["key_bindings"]
    assert got["male_in"] == "KeyQ" and got["undo"] == "KeyZ"


def test_reset_all_and_one(client, auth):
    kb = dict(kr.DEFAULT_BINDINGS, male_in="KeyQ", undo="KeyF")  # undo takes male_in's default key
    client.put("/api/settings", json=body(key_bindings=kb), headers=auth)
    one = client.post("/api/settings/reset?action=male_in", headers=auth).json()["key_bindings"]
    assert one["male_in"] == "KeyF" and len(set(one.values())) == len(one)
    assert one["undo"] == "KeyQ"  # swapped, no duplicate
    allr = client.post("/api/settings/reset", headers=auth).json()["key_bindings"]
    assert allr == kr.DEFAULT_BINDINGS
    assert client.post("/api/settings/reset?action=nope", headers=auth).status_code == 422
