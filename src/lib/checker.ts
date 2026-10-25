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
      const retryAfter = body?.retry_after;
      const waitMs = retryAfter ? Math.ceil(retryAfter * 1000) : 5000;
      return { username, status: 'rate_limited', message: `Rate limited — waiting ${Math.ceil(waitMs / 1000)}s...` };
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      if (errBody?.error === 'rate_limited') {
        return { username, status: 'rate_limited', message: 'Rate limited — waiting...' };
      }
      return { username, status: 'error', message: errBody?.message || `HTTP ${res.status}` };
    }

    const data = await res.json();

    if (data?.error === 'invalid') {
      return { username, status: 'invalid', message: data?.message || 'Invalid username' };
    }

    if (data?.error === 'rate_limited') {
      const retryAfter = data?.retry_after;
      const waitMs = retryAfter ? Math.ceil(retryAfter * 1000) : 5000;
      return { username, status: 'rate_limited', message: `Rate limited — waiting ${Math.ceil(waitMs / 1000)}s...` };
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

export async function checkWithRetry(
  username: string,
  maxRetries = 5,
  fallbackDelayMs = 5000,
): Promise<CheckResult> {
  let result = await checkUsername(username);
  let retries = 0;

  while (result.status === 'rate_limited' && retries < maxRetries) {
    const waitMs = parseRetryAfterMs(result.message) ?? fallbackDelayMs;
    await new Promise((r) => setTimeout(r, waitMs));
    result = await checkUsername(username);
    retries++;
  }

  return result;
}

function parseRetryAfterMs(message?: string): number | null {
  if (!message) return null;
  const match = message.match(/(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  return Math.ceil(parseFloat(match[1]) * 1000);
}
