const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function response(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);

    const body = await req.json().catch(() => null);
    const webhookUrl = typeof body?.webhookUrl === "string" ? body.webhookUrl.trim() : "";
    const content = typeof body?.content === "string" ? body.content.trim() : "";

    if (!webhookUrl || !content || content.length > 2000) {
      return response({ error: "invalid_request", message: "Webhook y mensaje son obligatorios." }, 400);
    }

    const parsedUrl = new URL(webhookUrl);
    const allowedHost = parsedUrl.hostname === "discord.com" || parsedUrl.hostname === "discordapp.com";
    if (parsedUrl.protocol !== "https:" || !allowedHost || !parsedUrl.pathname.startsWith("/api/webhooks/")) {
      return response({ error: "invalid_webhook", message: "La URL debe ser un webhook de Discord válido." }, 400);
    }

    const discordResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: ["everyone", "roles"] } }),
    });

    if (!discordResponse.ok) {
      return response({ error: "discord_error", message: `Discord rechazó el webhook (${discordResponse.status}).` }, 502);
    }

    return response({ sent: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar el webhook.";
    return response({ error: "internal_error", message }, 500);
  }
});
