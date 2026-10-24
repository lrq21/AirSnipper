/*
# Create found_usernames table

1. New Tables
- `found_usernames`
  - `id` (uuid, primary key)
  - `username` (text, unique, not null) — the Discord username that was found available
  - `length` (int, not null) — number of characters (3 or 4)
  - `status` (text, not null) — result status from the checker (e.g. "available", "taken", "invalid")
  - `checked_at` (timestamptz, default now())
2. Security
- Enable RLS on `found_usernames`.
- Grant CRUD to `anon` + `authenticated` — this is a no-auth single-tenant app.
- All policies allow public access since there is no sign-in screen.
*/

CREATE TABLE IF NOT EXISTS found_usernames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  length int NOT NULL,
  status text NOT NULL DEFAULT 'available',
  checked_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_found_usernames_status ON found_usernames(status);
CREATE INDEX IF NOT EXISTS idx_found_usernames_length ON found_usernames(length);

ALTER TABLE found_usernames ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON found_usernames TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_found" ON found_usernames;
CREATE POLICY "anon_select_found" ON found_usernames FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_found" ON found_usernames;
CREATE POLICY "anon_insert_found" ON found_usernames FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_found" ON found_usernames;
CREATE POLICY "anon_update_found" ON found_usernames FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_found" ON found_usernames;
CREATE POLICY "anon_delete_found" ON found_usernames FOR DELETE
  TO anon, authenticated USING (true);
