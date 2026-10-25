const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-username`;
const REQUEST_TIMEOUT_MS = 15000;

export type CheckStatus =
  | 'available'
  | 'taken'
  | 'invalid'
  | 'rate_limited'
  | 'error';

export interface CheckResult {
  username: string;
  status: CheckStatus;
  message?: string;
  retryAfterMs?: number;
}

export async function checkUsername(username: string): Promise<CheckResult> {
  try {
    const url = `${EDGE_FUNCTION_URL}?username=${encodeURIComponent(username)}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });
    window.clearTimeout(timeout);

    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const retryAfter = getRetryAfterMs(res.headers.get('Retry-After'), body?.retry_after);
      return { username, status: 'rate_limited', retryAfterMs: retryAfter, message: formatRateLimitMessage(retryAfter) };
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      if (errBody?.error === 'rate_limited') {
        const retryAfter = getRetryAfterMs(res.headers.get('Retry-After'), errBody?.retry_after);
        return { username, status: 'rate_limited', retryAfterMs: retryAfter, message: formatRateLimitMessage(retryAfter) };
      }
      return { username, status: 'error', message: errBody?.message || `HTTP ${res.status}` };
    }

    const data = await res.json();

    if (data?.error === 'invalid') {
      return { username, status: 'invalid', message: data?.message || 'Invalid username' };
    }

    if (data?.error === 'rate_limited') {
      const retryAfter = getRetryAfterMs(res.headers.get('Retry-After'), data?.retry_after);
      return { username, status: 'rate_limited', retryAfterMs: retryAfter, message: formatRateLimitMessage(retryAfter) };
    }

    if (typeof data?.taken === 'boolean') {
      return {
        username,
        status: data.taken ? 'taken' : 'available',
      };
    }

    return { username, status: 'error', message: 'Unexpected response from API' };
  } catch (err) {
    const message = err instanceof DOMException && err.name === 'AbortError'
      ? 'La comprobación tardó demasiado'
      : (err as Error).message;
    return { username, status: 'error', message };
  }
}

function getRetryAfterMs(headerValue: string | null, bodyValue: unknown): number | undefined {
  const seconds = Number(headerValue ?? bodyValue);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : undefined;
}

function formatRateLimitMessage(retryAfterMs?: number): string {
  if (!retryAfterMs) return 'Discord ha limitado las comprobaciones. La búsqueda se detuvo.';
  return `Discord ha limitado las comprobaciones. Inténtalo de nuevo en ${Math.ceil(retryAfterMs / 1000)}s.`;
}
