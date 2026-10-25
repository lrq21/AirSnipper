const WEBHOOK_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-hit-webhook`;

export const HIT_ROLE_ID = '1562921554977751151';

export async function sendWebhookMessage(webhookUrl: string, content: string): Promise<void> {
  const response = await fetch(WEBHOOK_FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ webhookUrl, content }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.message === 'string' ? body.message : 'No se pudo enviar el webhook');
  }
}
