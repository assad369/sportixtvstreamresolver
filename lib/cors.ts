// Shared CORS headers so the proxy/stream/status endpoints work from an
// embed iframe hosted on any origin.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
};

export function withCors(headers: HeadersInit = {}): Headers {
  const merged = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    merged.set(key, value);
  }
  return merged;
}

/** Standard OPTIONS preflight response. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: withCors() });
}
