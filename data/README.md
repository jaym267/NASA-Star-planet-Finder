# Data

Raw light curves are **not** committed to this repo. They're public, re-downloadable from NASA's archive, and can be hundreds of MB. The backend caches anything it downloads in `data/cache/` (git-ignored).

What *is* committed here:

- `targets.json` — example stars used for testing. Each one has known planets, so we can check our tools rediscover them.

See `docs/data-sources.md` for where every dataset comes from.
