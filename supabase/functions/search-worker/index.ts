import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PACE_MS = 5000;
const RUN_BUDGET_MS = 45000;
const LEASE_MS = 90000;
const DEFAULT_RETRY_MS = 60000;
const MAX_CANDIDATE_TRIES = 200;

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const LETTERS_AND_NUMBERS = `${LETTERS}${NUMBERS}`;

type Pattern = "letters" | "letters_numbers" | "underscore_letters" | "random";

interface SearchJob {
  is_running: boolean;
  username_length: number;
  pattern: Pattern;
  checked: number;
  available: number;
  taken: number;
}

type DiscordResult =
  | { kind: "checked"; taken: boolean }
  | { kind: "invalid" }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "error"; message: string };

function response(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomChar(charset: string): string {
  return charset[Math.floor(Math.random() * charset.length)];
}

function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function generateLetters(length: number): string {
  return Array.from({ length }, () => randomChar(LETTERS)).join("");
}

function generateNumbers(length: number): string {
  return Array.from({ length }, () => randomChar(NUMBERS)).join("");
}

function generateLettersAndNumbers(length: number): string {
  if (length < 2) return randomChar(LETTERS_AND_NUMBERS);
  const chars = [randomChar(LETTERS), randomChar(NUMBERS)];
  while (chars.length < length) chars.push(randomChar(LETTERS_AND_NUMBERS));
  return shuffle(chars).join("");
}

function generateUnderscorePattern(length: number): string {
  if (length === 1) return "_";
  const underscorePosition = Math.floor(Math.random() * (length - 1)) + 1;
  return Array.from({ length }, (_, index) => index === underscorePosition ? "_" : randomChar(LETTERS_AND_NUMBERS)).join("");
}

function generateUsername(length: number, pattern: Pattern): string {
  if (pattern === "letters") return generateLetters(length);
  if (pattern === "letters_numbers") return generateLettersAndNumbers(length);
  if (pattern === "underscore_letters") return generateUnderscorePattern(length);

  const randomPattern = Math.floor(Math.random() * 4);
  if (randomPattern === 0) return generateLetters(length);
  if (randomPattern === 1) return generateNumbers(length);
  if (randomPattern === 2) return generateLettersAndNumbers(length);
  return generateUnderscorePattern(length);
}

async function checkDiscord(username: string): Promise<DiscordResult> {
  const apiRes = await fetch("https://discord.com/api/v9/unique-username/username-attempt-unauthed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://discord.com",
      "Referer": "https://discord.com/",
    },
    body: JSON.stringify({ username }),
  });

  if (apiRes.status === 429) {
    const body = await apiRes.json().catch(() => ({}));
    const seconds = Number(body?.retry_after ?? apiRes.headers.get("Retry-After"));
    const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : DEFAULT_RETRY_MS;
    return { kind: "rate_limited", retryAfterMs };
  }

  const data = await apiRes.json().catch(() => ({}));

  if (apiRes.status === 400 && data?.code === 50035) return { kind: "invalid" };
  if (!apiRes.ok) return { kind: "error", message: `Discord API returned ${apiRes.status}` };

  return { kind: "checked", taken: data?.taken === true };
}

async function findFreshCandidate(length: number, pattern: Pattern): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_CANDIDATE_TRIES; attempt += 1) {
    const username = generateUsername(length, pattern);
    const { data: cached, error } = await supabase
      .from("username_cache")
      .select("status, checked_at")
      .eq("username", username)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const isFresh = cached && cached.status !== "invalid"
      && Date.now() - new Date(cached.checked_at).getTime() < CACHE_TTL_MS;
    if (!isFresh) return username;
  }
  return null;
}

async function saveJob(patch: Partial<SearchJob> & { next_run_at?: string; lease_until?: string | null; last_message?: string }) {
  const { error } = await supabase
    .from("search_job")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}

async function runWorker(): Promise<string> {
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("search_job")
    .update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("id", 1)
    .eq("is_running", true)
    .lte("next_run_at", nowIso)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select("is_running, username_length, pattern, checked, available, taken")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return "idle";

  const job = claimed as SearchJob;
  const deadline = Date.now() + RUN_BUDGET_MS;
  let { checked, available, taken } = job;
  let message = "Buscando nombres";
  let nextRunAt = new Date().toISOString();

  try {
    while (Date.now() < deadline) {
      const { data: current, error: stateError } = await supabase
        .from("search_job")
        .select("is_running")
        .eq("id", 1)
        .maybeSingle();
      if (stateError) throw new Error(stateError.message);
      if (!current?.is_running) {
        message = "Búsqueda detenida";
        break;
      }

      const username = await findFreshCandidate(job.username_length, job.pattern);
      if (!username) {
        message = "No se encontraron nombres nuevos para comprobar";
        break;
      }

      const result = await checkDiscord(username);

      if (result.kind === "rate_limited") {
        nextRunAt = new Date(Date.now() + result.retryAfterMs).toISOString();
        message = `Discord limitó las comprobaciones. Reanuda en ${Math.ceil(result.retryAfterMs / 1000)}s.`;
        break;
      }

      if (result.kind === "checked") {
        const status = result.taken ? "taken" : "available";
        await supabase
          .from("username_cache")
          .upsert({ username, status, checked_at: new Date().toISOString() }, { onConflict: "username" });
        checked += 1;
        if (result.taken) {
          taken += 1;
        } else {
          available += 1;
          await supabase
            .from("found_usernames")
            .upsert({ username, length: username.length, status: "available" }, { onConflict: "username", ignoreDuplicates: true });
        }
        message = `Última comprobación: @${username}`;
      } else if (result.kind === "invalid") {
        await supabase
          .from("username_cache")
          .upsert({ username, status: "invalid", checked_at: new Date().toISOString() }, { onConflict: "username" });
        message = `@${username} no es un nombre válido`;
      } else {
        message = result.message;
      }

      await saveJob({ checked, available, taken, last_message: message });
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    }
  } finally {
    await saveJob({
      checked, available, taken,
      next_run_at: nextRunAt,
      lease_until: null,
      last_message: message,
    });
  }

  return message;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const outcome = await runWorker();
    return response({ ok: true, outcome }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return response({ error: "internal_error", message }, 500);
  }
});
