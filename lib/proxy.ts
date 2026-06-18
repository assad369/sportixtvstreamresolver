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

interface SegmentUnit {
  /** Rewritten comment/blank lines immediately preceding the URI line. */
  leadingLines: string[];
  /** The rewritten URI line itself. */
  uriLine: string;
  /** Absolute origin URL this URI line points to. */
  absoluteUri: string;
  /** Whether this URI points at a nested/variant playlist rather than a segment. */
  isPlaylistUri: boolean;
}

/**
 * Group playlist lines into logical units (the tag/blank lines that lead up
 * to each URI line, plus the URI line itself). Grouping by trailing-URI lets
 * us cleanly drop the last N *segments* (live-edge holdback) without
 * splitting a segment from its #EXTINF/#EXT-X-DISCONTINUITY/etc. tags.
 */
function groupSegments(
  lines: string[],
  baseUrl: string,
  publicId: string,
): { units: SegmentUnit[]; trailer: string[] } {
  const units: SegmentUnit[] = [];
  let pending: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      pending.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      pending.push(rewriteTagUris(trimmed, baseUrl, publicId));
      continue;
    }

    // A resource URI line (segment or variant playlist).
    const absolute = absolutize(trimmed, baseUrl);
    const isPlaylistUri = isPlaylist(trimmed);
    const uriLine = isPlaylistUri
      ? proxyUrl(publicId, absolute)
      : streamUrl(publicId, absolute);
    units.push({ leadingLines: pending, uriLine, absoluteUri: absolute, isPlaylistUri });
    pending = [];
  }

  // Lines after the last URI line (e.g. #EXT-X-ENDLIST) — always kept as-is.
  return { units, trailer: pending };
}

export interface RewritePlaylistResult {
  body: string;
  /** Absolute origin URLs of every segment/key/map URI in the playlist, including held-back ones. */
  segmentUris: string[];
  /** Lists variant playlists rather than segments — no holdback/prefetch applies. */
  isMaster: boolean;
  /** Finite playlist (has #EXT-X-ENDLIST) — no holdback applies. */
  isVod: boolean;
}

/**
 * Rewrite every URI in an HLS playlist so it flows back through our API:
 *  - variant playlists (.m3u8) → /api/proxy (so nested playlists stay proxied)
 *  - #EXT-X-KEY URIs and segments → /api/stream (raw byte proxy)
 * Relative URIs are resolved against `baseUrl` (the playlist's real URL).
 *
 * For live media playlists, `opts.holdbackCount` withholds that many segments
 * from the live edge of the *served* body (tail-trimmed, so #EXT-X-MEDIA-
 * SEQUENCE never needs recalculating) — this gives background prefetch a
 * head start before a player can ever request those segments. `segmentUris`
 * still includes the held-back ones so the caller can prefetch them.
 */
export function rewritePlaylist(
  body: string,
  baseUrl: string,
  publicId: string,
  opts: { holdbackCount?: number } = {},
): RewritePlaylistResult {
  const lines = body.split(/\r?\n/);
  const isMaster = lines.some((l) => l.trim().startsWith("#EXT-X-STREAM-INF"));
  const isVod = lines.some((l) => l.trim().startsWith("#EXT-X-ENDLIST"));

  const { units, trailer } = groupSegments(lines, baseUrl, publicId);

  const segmentUris = units
    .filter((u) => !u.isPlaylistUri)
    .map((u) => u.absoluteUri);

  const holdbackCount = isMaster || isVod ? 0 : Math.max(0, opts.holdbackCount ?? 0);
  const keptUnits =
    holdbackCount > 0 ? units.slice(0, Math.max(0, units.length - holdbackCount)) : units;

  const outLines: string[] = [];
  for (const unit of keptUnits) {
    outLines.push(...unit.leadingLines, unit.uriLine);
  }
  outLines.push(...trailer);

  return { body: outLines.join("\n"), segmentUris, isMaster, isVod };
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
