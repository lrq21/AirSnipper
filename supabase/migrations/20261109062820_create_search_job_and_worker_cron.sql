/*
# Server-side continuous username search

1. New Tables
- `search_job`: a single row (id = 1) that holds the state of the continuous search.
  - `is_running` (boolean): whether the server should keep checking names.
  - `function_url` (text): address of the search worker, saved by the app when a search starts.
  - `username_length` (int, 3-6) and `pattern` (text): what kind of names to generate.
  - `next_run_at` (timestamptz): the worker waits until this time (used after Discord asks us to slow down).
  - `lease_until` (timestamptz): short lock so two workers never run at the same time.
  - `checked`, `available`, `taken` (int): running totals shown in the app.
  - `last_message` (text): latest status message from the worker.
2. Scheduled work
- A pg_cron job runs every minute. If a search is running, it calls the search worker over HTTP.
3. Security
- Enable RLS on `search_job`.
- No sign-in screen exists, so anon + authenticated can read and update the single row.
- The worker uses the service role.
4. Notes
- The schedule does not contain any address or secret; it reads the worker address from the row above.
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE TABLE IF NOT EXISTS search_job (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_running boolean NOT NULL DEFAULT false,
  function_url text,
  username_length int NOT NULL DEFAULT 3 CHECK (username_length BETWEEN 3 AND 6),
  pattern text NOT NULL DEFAULT 'letters' CHECK (pattern IN ('letters', 'letters_numbers', 'underscore_letters', 'random')),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  checked int NOT NULL DEFAULT 0,
  available int NOT NULL DEFAULT 0,
  taken int NOT NULL DEFAULT 0,
  last_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO search_job (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE search_job ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON search_job TO anon, authenticated;
GRANT SELECT, UPDATE ON search_job TO service_role;

DROP POLICY IF EXISTS "anon_select_search_job" ON search_job;
CREATE POLICY "anon_select_search_job" ON search_job FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_search_job" ON search_job;
CREATE POLICY "anon_update_search_job" ON search_job FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

SELECT cron.schedule(
  'search-worker-tick',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := sj.function_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    )
    FROM public.search_job sj
    WHERE sj.id = 1 AND sj.is_running AND sj.function_url IS NOT NULL
  $cron$
);
