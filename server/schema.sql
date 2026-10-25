-- One row per player per season and mode: their best run. pkey is the device-side player key and
-- is never returned; tag is a short hash of it so a device can spot its own rows.
CREATE TABLE IF NOT EXISTS scores (
  season INTEGER NOT NULL,
  mode TEXT NOT NULL,
  pkey TEXT NOT NULL,
  tag TEXT NOT NULL,
  name TEXT NOT NULL,
  diff TEXT,
  score INTEGER NOT NULL,
  level INTEGER NOT NULL,
  acc INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (season, mode, pkey)
);
CREATE INDEX IF NOT EXISTS board ON scores (season, mode, score DESC);

-- Submissions per hashed IP per hour, for rate limiting.
CREATE TABLE IF NOT EXISTS hits (
  ip TEXT NOT NULL,
  hour INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (ip, hour)
);
