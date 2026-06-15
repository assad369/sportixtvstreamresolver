// Shared types for the M3U8 stream proxy / resolver.

export type SessionStatus = "active" | "refreshing" | "failed";

/** Headers captured from the player's real m3u8 request, replayed by the proxy. */
export interface StreamHeaders {
  referer: string;
  origin: string;
  userAgent: string;
}

/** Result of extracting an m3u8 URL from an embed page. */
export interface ResolveResult {
  m3u8Url: string;
  headers: StreamHeaders;
}

/** A resolved, playable stream — the runtime view used by proxy/stream routes. */
export interface PlayableStream {
  publicId: string;
  embedUrl: string;
  m3u8Url: string;
  headers: StreamHeaders;
  resolvedAt: number;
  status: SessionStatus;
}

/** Serialized stream document returned to the admin dashboard. */
export interface StreamDTO {
  id: string;
  name: string;
  embedUrl: string;
  publicId: string;
  enabled: boolean;
  status: "active" | "refreshing" | "failed" | "unresolved";
  lastM3u8Url?: string;
  lastHeaders?: StreamHeaders;
  lastResolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Event payload pushed over the /api/status SSE channel. */
export interface StatusEvent {
  status: SessionStatus;
  message?: string;
  at: number;
}
