"""In-memory stand-in for the few Redis calls the app makes, so tests never touch the real Redis."""


class FakeRedis:
    def __init__(self):
        self.data: dict[str, str] = {}
        self.ttl: dict[str, int | None] = {}
        self.lists: dict[str, list[str]] = {}
        self.fail = False  # set True to simulate Redis being down

    def _check(self):
        if self.fail:
            import redis
            raise redis.ConnectionError("down")

    def set(self, key, value, ex=None):
        self._check()
        self.data[key] = value
        self.ttl[key] = ex

    def exists(self, key):
        self._check()
        return int(key in self.data)

    def delete(self, *keys):
        self._check()
        for k in keys:
            self.data.pop(k, None)
            self.ttl.pop(k, None)

    def mget(self, keys):
        self._check()
        return [self.data.get(k) for k in keys]

    def keys(self, pattern="*"):
        self._check()
        prefix = pattern.rstrip("*")
        return [k for k in self.data if k.startswith(prefix)]

    def rpush(self, name, *values):
        self._check()
        self.lists.setdefault(name, []).extend(values)

    def lrange(self, name, start, end):
        self._check()
        items = self.lists.get(name, [])
        return items[start:] if end == -1 else items[start:end + 1]
