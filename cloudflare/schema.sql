-- Daily index reads. `visitors` only dedupes readers within a day and keeps no IPs.
CREATE TABLE IF NOT EXISTS reads (day TEXT PRIMARY KEY, reads INTEGER NOT NULL DEFAULT 0, readers INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS visitors (day TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, hash));
-- The same daily counts split by Cloudflare's two-letter country or region code (XX when unknown).
CREATE TABLE IF NOT EXISTS countries (day TEXT NOT NULL, country TEXT NOT NULL, reads INTEGER NOT NULL DEFAULT 0, readers INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, country));
-- Like totals decay lazily from decayed_at, a UTC date.
CREATE TABLE IF NOT EXISTS likes (name TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0), decayed_at TEXT NOT NULL);
-- Daily salted hashes dedupe likes and installs; no IP or user agent is stored.
CREATE TABLE IF NOT EXISTS like_votes (day TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, name, hash));
CREATE INDEX IF NOT EXISTS like_votes_by_person ON like_votes (day, hash);
