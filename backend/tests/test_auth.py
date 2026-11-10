from tests.conftest import make_user


def test_login(client):
    make_user("a@x.com")
    assert client.post("/api/auth/login", json={"email": "a@x.com", "password": "bad"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "A@x.com", "password": "pw"})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/api/auth/me", headers=h).json()["email"] == "a@x.com"
    assert client.get("/api/auth/me").status_code == 401
