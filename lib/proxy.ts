import type { StreamHeaders } from "@/types/stream";
import { curlFetch } from "@/lib/originFetch";

/** Origin returned a token-expiry status — the caller should re-resolve. */
export class TokenExpiredError extends Error {
  constructor(public status: number) {
    super(`Origin returned ${status} (token likely expired)`);
    this.name = "TokenExpiredError";
  }
}

/**
 * Fetch a playlist with the stream's replay headers. Throws TokenExpiredError
 * on 403/404 so the proxy route can trigger an auto re-resolve.
 */
export async function fetchPlaylist(
  url: string,
  source: { headers: StreamHeaders },
): Promise<string> {
  const res = await curlFetch(url, source.headers);

  if (res.status === 403 || res.status === 404) {
    throw new TokenExpiredError(res.status);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Failed to fetch playlist: ${res.status}`);
  }
  return res.body.toString("utf8");
}

const ABSOLUTE_RE = /^https?:\/\//i;

function isPlaylist(uri: string): boolean {
  return /\.m3u8(\?|$)/i.test(uri);
}

/** Resolve a possibly-relative playlist URI against the playlist's own URL. */
function absolutize(uri: string, baseUrl: string): string {
  if (ABSOLUTE_RE.test(uri)) return uri;
  return new URL(uri, baseUrl).toString();
}

function proxyUrl(publicId: string, absoluteUri: string): string {
  return `/api/proxy?id=${encodeURIComponent(publicId)}&src=${encodeURIComponent(absoluteUri)}`;
}

function streamUrl(publicId: string, absoluteUri: string): string {
  return `/api/stream?id=${encodeURIComponent(publicId)}&seg=${encodeURIComponent(absoluteUri)}`;
}

/**
 * Rewrite every URI in an HLS playlist so it flows back through our API:
 *  - variant playlists (.m3u8) → /api/proxy (so nested playlists stay proxied)
 *  - #EXT-X-KEY URIs and segments → /api/stream (raw byte proxy)
 * Relative URIs are resolved against `baseUrl` (the playlist's real URL).
 */
export function rewritePlaylist(
  body: string,
  baseUrl: string,
  publicId: string,
): string {
  const lines = body.split(/\r?\n/);

  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return line;

    // Tag lines: only #EXT-X-KEY / #EXT-X-MEDIA / #EXT-X-MAP carry URIs.
    if (trimmed.startsWith("#")) {
      return rewriteTagUris(trimmed, baseUrl, publicId);
    }

    // Otherwise it's a resource URI (segment or variant playlist).
    const absolute = absolutize(trimmed, baseUrl);
    return isPlaylist(trimmed)
      ? proxyUrl(publicId, absolute)
      : streamUrl(publicId, absolute);
  });

  return rewritten.join("\n");
}

/** Rewrite URI="..." attributes inside HLS tags (keys, maps, alt media). */
function rewriteTagUris(line: string, baseUrl: string, publicId: string): string {
  return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
    const absolute = absolutize(uri, baseUrl);
    // #EXT-X-MEDIA can reference variant playlists; route those through proxy.
    const target = isPlaylist(uri)
      ? proxyUrl(publicId, absolute)
      : streamUrl(publicId, absolute);
    return `URI="${target}"`;
  });
}
