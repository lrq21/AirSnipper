import { supabase } from '@/lib/supabase';
import type { GenerationPattern } from '@/lib/generator';
import type { CheckResult, CheckStatus } from '@/lib/checker';

export interface SearchJob {
  is_running: boolean;
  next_run_at: string;
  checked: number;
  available: number;
  taken: number;
  last_message: string | null;
}

const SEARCH_JOB_COLUMNS = 'is_running, next_run_at, checked, available, taken, last_message';
const RECENT_CHECKS_LIMIT = 20;

function workerUrl(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-worker`;
}

export async function fetchSearchJob(): Promise<SearchJob> {
  const { data, error } = await supabase
    .from('search_job')
    .select(SEARCH_JOB_COLUMNS)
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No se encontró la configuración de la búsqueda.');
  return data as SearchJob;
}

export async function fetchRecentChecks(): Promise<CheckResult[]> {
  const { data, error } = await supabase
    .from('username_cache')
    .select('username, status')
    .in('status', ['available', 'taken', 'invalid'])
    .order('checked_at', { ascending: false })
    .limit(RECENT_CHECKS_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ username: row.username, status: row.status as CheckStatus }));
}

export async function startSearchJob(settings: { usernameLength: 3 | 4 | 5 | 6; pattern: GenerationPattern }): Promise<void> {
  const { error } = await supabase
    .from('search_job')
    .update({
      is_running: true,
      function_url: workerUrl(),
      username_length: settings.usernameLength,
      pattern: settings.pattern,
      next_run_at: new Date().toISOString(),
      lease_until: null,
      checked: 0,
      available: 0,
      taken: 0,
      last_message: 'Búsqueda iniciada',
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (error) throw new Error(error.message);

  void fetch(workerUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  }).catch(() => undefined);
}

export async function stopSearchJob(): Promise<void> {
  const { error } = await supabase
    .from('search_job')
    .update({ is_running: false, last_message: 'Búsqueda detenida', updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(error.message);
}
