import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function response(body: Record<string, unknown>, status: number, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(extra ?? {}) },
  });
}

function randomForwardedFor(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `${octet()}.${octet()}.${octet()}.${octet()}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const username = url.searchParams.get("username");

    if (!username) {
      return response({ error: "Missing 'username' parameter" }, 400);
    }

    if (username.length < 2 || username.length > 32) {
      return response({ error: "invalid", message: "Username must be between 2 and 32 characters" }, 400);
    }

    // Cache lookup: skip Discord entirely if we already checked this name recently.
    const { data: cached } = await supabase
      .from("username_cache")
      .select("status, checked_at")
      .eq("username", username)
      .maybeSingle();

    if (cached && cached.status !== "invalid") {
      const age = Date.now() - new Date(cached.checked_at).getTime();
      if (age < CACHE_TTL_MS) {
        const taken = cached.status === "taken";
        return response({ username, taken, available: !taken, cached: true }, 200);
      }
    }

    const apiRes = await fetch("https://discord.com/api/v9/unique-username/username-attempt-unauthed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-Forwarded-For": randomForwardedFor(),
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://discord.com",
        "Referer": "https://discord.com/",
      },
      body: JSON.stringify({ username }),
    });

    if (apiRes.status === 429) {
      const rlBody = await apiRes.json().catch(() => ({}));
      const retryAfter = rlBody?.retry_after ?? rlBody?.global_cooldown ?? null;
      return response({ error: "rate_limited", retry_after: retryAfter }, 429, {
        "Retry-After": retryAfter ? String(retryAfter) : "5",
      });
    }

    const data = await apiRes.json();

    if (apiRes.status === 400 && data?.code === 50035) {
      const errMsg = data?.errors?.username?._errors?.[0]?.message ?? "Invalid username";
      const errCode = data?.errors?.username?._errors?.[0]?.code ?? "USERNAME_INVALID";
      return response({ error: "invalid", message: errMsg, code: errCode }, 200);
    }

    if (!apiRes.ok) {
      return response({ error: "api_error", message: `Discord API returned ${apiRes.status}`, detail: data }, 502);
    }

    const taken = data?.taken === true;
    const status = taken ? "taken" : "available";

    await supabase
      .from("username_cache")
      .upsert({ username, status, checked_at: new Date().toISOString() }, { onConflict: "username" });

    return response({ username, taken, available: !taken }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return response({ error: "internal_error", message }, 500);
  }
});
