const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const username = url.searchParams.get("username");

    if (!username) {
      return new Response(
        JSON.stringify({ error: "Missing 'username' parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (username.length < 2 || username.length > 32) {
      return new Response(
        JSON.stringify({ error: "invalid", message: "Username must be between 2 and 32 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiRes = await fetch("https://discord.com/api/v9/unique-username/username-attempt-unauthed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ username }),
    });

    if (apiRes.status === 429) {
      const rlBody = await apiRes.json().catch(() => ({}));
      const retryAfter = rlBody?.retry_after ?? rlBody?.global_cooldown ?? null;
      return new Response(
        JSON.stringify({ error: "rate_limited", retry_after: retryAfter }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await apiRes.json();

    if (apiRes.status === 400 && data?.code === 50035) {
      const errMsg = data?.errors?.username?._errors?.[0]?.message ?? "Invalid username";
      const errCode = data?.errors?.username?._errors?.[0]?.code ?? "USERNAME_INVALID";
      return new Response(
        JSON.stringify({ error: "invalid", message: errMsg, code: errCode }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!apiRes.ok) {
      return new Response(
        JSON.stringify({ error: "api_error", message: `Discord API returned ${apiRes.status}`, detail: data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const taken = data?.taken === true;
    return new Response(
      JSON.stringify({ username, taken, available: !taken }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "internal_error", message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
