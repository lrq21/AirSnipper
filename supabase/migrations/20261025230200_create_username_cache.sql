/*
# Username availability cache

1. New Tables
- `username_cache`
  - `username` (text, primary key): the Discord username checked
  - `status` (text): one of 'available' | 'taken' | 'invalid'
  - `checked_at` (timestamptz): when Discord was last queried for this name
2. Purpose
- Lets the check-username edge function skip Discord entirely when a name was
  already checked recently, reducing load on Discord and avoiding rate limits
  for repeat checks (list re-runs, duplicate generations).
3. Security
- Enable RLS on `username_cache`.
- This is a single-tenant, no-auth tool, so anon + authenticated get full CRUD.
- `USING (true)` / `WITH CHECK (true)` is intentional: the cache is shared
  public availability data, not private user data.
4. Notes
- Stale entries older than 24h are ignored by the edge function, so a name
  can eventually be rechecked against Discord.
*/

CREATE TABLE IF NOT EXISTS username_cache (
  username text PRIMARY KEY,
  status text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE username_cache ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON username_cache TO anon, authenticated;

DROP POLICY IF EXISTS "anon_read_cache" ON username_cache;
CREATE POLICY "anon_read_cache" ON username_cache FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_cache" ON username_cache;
CREATE POLICY "anon_insert_cache" ON username_cache FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_cache" ON username_cache;
CREATE POLICY "anon_update_cache" ON username_cache FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_cache" ON username_cache;
CREATE POLICY "anon_delete_cache" ON username_cache FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS username_cache_checked_at_idx ON username_cache (checked_at);
