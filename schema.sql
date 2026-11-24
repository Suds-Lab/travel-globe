-- Travel Globe leaderboard schema (Cloudflare D1 / SQLite).
-- Apply with: npx wrangler d1 execute travel-globe --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,            -- UUIDv7, never shown publicly
  tag        TEXT NOT NULL,               -- short hash of id, lets a browser spot its own row
  name       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',  -- full map {world:{},us:{},ca:{}}, private
  w_pts      INTEGER NOT NULL DEFAULT 0,
  w_n        INTEGER NOT NULL DEFAULT 0,
  us_pts     INTEGER NOT NULL DEFAULT 0,
  us_n       INTEGER NOT NULL DEFAULT 0,
  ca_pts     INTEGER NOT NULL DEFAULT 0,
  ca_n       INTEGER NOT NULL DEFAULT 0,
  link_hash  TEXT,                        -- SHA-256 of the edit-link secret (NULL = no PIN set)
  pin_hash   TEXT,                        -- SHA-256 of id + link secret + PIN
  fails      INTEGER NOT NULL DEFAULT 0,  -- wrong PIN attempts in a row
  lock_until INTEGER NOT NULL DEFAULT 0,  -- ms timestamp
  created    INTEGER NOT NULL,
  updated    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS entries_w  ON entries (w_pts DESC, w_n DESC, created);
CREATE INDEX IF NOT EXISTS entries_us ON entries (us_pts DESC, us_n DESC, created);
CREATE INDEX IF NOT EXISTS entries_ca ON entries (ca_pts DESC, ca_n DESC, created);

-- Each browser that is "signed in" to an entry holds a random device token.
CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,            -- SHA-256 of the device token
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  created    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_entry ON devices (entry_id);
