-- The matchmaking tables for Postgres (Supabase): schema.sql's, with the row number SQLite keeps by itself (rowid:
-- a quick match takes the room that waited longest) as a column. In a schema of their own, bt3: the function
-- reaches them through the database's own connection, and nothing is exposed through the project's API.
CREATE SCHEMA IF NOT EXISTS bt3;
CREATE TABLE IF NOT EXISTS bt3.rooms (rowid BIGSERIAL, code TEXT PRIMARY KEY, made BIGINT NOT NULL, version BIGINT NOT NULL, ip TEXT NOT NULL, host_key TEXT NOT NULL, join_key TEXT, host_name TEXT NOT NULL, join_name TEXT, host_addrs TEXT NOT NULL, join_addrs TEXT, queue TEXT, who TEXT, lobby BIGINT, loc TEXT, join_region TEXT);
CREATE TABLE IF NOT EXISTS bt3.used (what TEXT NOT NULL, slot BIGINT NOT NULL, n BIGINT NOT NULL, PRIMARY KEY (what, slot));
CREATE TABLE IF NOT EXISTS bt3.watchers (key TEXT PRIMARY KEY, code TEXT NOT NULL, made BIGINT NOT NULL, name TEXT NOT NULL, addrs TEXT NOT NULL);
-- The ranking's matches (index.ts, POST /v1/match): one row a match, from its two players' reports (`reports`: bit 0
-- the host's, bit 1 the joiner's; `ok` false when they named different winners). `w`: 0 `a` won, 1 `b`.
CREATE TABLE IF NOT EXISTS bt3.matches (id BIGSERIAL PRIMARY KEY, made BIGINT NOT NULL, ip TEXT NOT NULL, grp TEXT, key TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, w SMALLINT NOT NULL, tour BOOLEAN NOT NULL DEFAULT false, secs INT NOT NULL, hp_a INT NOT NULL, hp_b INT NOT NULL, combo_a INT NOT NULL, combo_b INT NOT NULL, hits_a INT NOT NULL, hits_b INT NOT NULL, cost_a INT NOT NULL, cost_b INT NOT NULL, chars_a JSONB NOT NULL, chars_b JSONB NOT NULL, reports SMALLINT NOT NULL, ok BOOLEAN NOT NULL DEFAULT true);
CREATE INDEX IF NOT EXISTS matches_key ON bt3.matches (key);
CREATE INDEX IF NOT EXISTS matches_ip ON bt3.matches (ip, made);
