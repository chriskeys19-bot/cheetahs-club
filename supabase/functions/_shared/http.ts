export const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'

export const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

const SECRET_FIELD = /"(?:refresh_token|access_token|client_secret|id_token)"\s*:/i

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

/** Drop token-shaped values before anything is written to logs. */
export function redactForLog(value: string): string {
  return value
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/1\/\/[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 180)
}

export function json(req: Request, status: number, body: unknown): Response {
  let text = JSON.stringify(body)
  if (SECRET_FIELD.test(text)) {
    console.error('refusing a YouTube response that included a token field')
    text = JSON.stringify({ error: 'YouTube is not available right now.' })
    status = 500
  }
  return new Response(text, {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}
