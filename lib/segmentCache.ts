import type { StreamHeaders } from "@/types/stream";
import { curlFetch } from "@/lib/originFetch";

// Warm in-memory cache of fetched segment bytes, keyed by absolute origin
// segment URL. Populated ahead of time by background prefetch (triggered from
// the playlist proxy route) so that by the time a player requests a segment,
// it's already sitting in memory — no origin round-trip on the hot path.
// Parked on globalThis so dev hot-reloads don't wipe it, same pattern as
// lib/cache.ts.

const SEGMENT_CACHE_TTL_SECONDS = Number(
  process.env.SEGMENT_CACHE_TTL_SECONDS ?? "90",
);
const TTL_MS = SEGMENT_CACHE_TTL_SECONDS * 1000;

const MAX_ENTRIES = Number(process.env.SEGMENT_CACHE_MAX_ENTRIES ?? "500");
const MAX_BYTES = Number(
  process.env.SEGMENT_CACHE_MAX_BYTES ?? String(256 * 1024 * 1024),
);

interface CachedSegment {
  status: number;
  body: Buffer;
  fetchedAt: number;
}

const globalForSegmentCache = globalThis as unknown as {
  __segmentCache?: Map<string, CachedSegment>;
  __segmentPrefetchInFlight?: Map<string, Promise<void>>;
};

const cache: Map<string, CachedSegment> =
  globalForSegmentCache.__segmentCache ?? new Map<string, CachedSegment>();
if (!globalForSegmentCache.__segmentCache) {
  globalForSegmentCache.__segmentCache = cache;
}

const inFlight: Map<string, Promise<void>> =
  globalForSegmentCache.__segmentPrefetchInFlight ??
  new Map<string, Promise<void>>();
if (!globalForSegmentCache.__segmentPrefetchInFlight) {
  globalForSegmentCache.__segmentPrefetchInFlight = inFlight;
}

let totalBytes = 0;
for (const entry of cache.values()) totalBytes += entry.body.length;

/** Return the cached segment bytes only if still within TTL. */
export function getCachedSegment(url: string): CachedSegment | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(url);
    totalBytes -= entry.body.length;
    return undefined;
  }
  return entry;
}

function evictOldestUntilWithinBounds(): void {
  if (cache.size <= MAX_ENTRIES && totalBytes <= MAX_BYTES) return;
  // Map preserves insertion order, so the first key is the oldest entry —
  // a simple FIFO is good enough here, no need for real LRU bookkeeping.
  for (const [url, entry] of cache) {
    if (cache.size <= MAX_ENTRIES && totalBytes <= MAX_BYTES) break;
    cache.delete(url);
    totalBytes -= entry.body.length;
  }
}

/**
 * Fetch a segment in the background and warm the cache, deduping concurrent
 * calls for the same URL (many viewers polling the playlist at once). Errors
 * are swallowed — a failed prefetch just means the player's own request falls
 * back to the existing cold curlStream path.
 */
export function prefetchSegment(url: string, headers: StreamHeaders): void {
  if (getCachedSegment(url)) return;
  if (inFlight.has(url)) return;

  const task = curlFetch(url, headers)
    .then((result) => {
      if (result.status !== 200 && result.status !== 206) return;
      cache.set(url, {
        status: result.status,
        body: result.body,
        fetchedAt: Date.now(),
      });
      totalBytes += result.body.length;
      evictOldestUntilWithinBounds();
    })
    .catch(() => {
      // Swallowed — the player's own request will hit the cold path.
    })
    .finally(() => {
      inFlight.delete(url);
    });

  inFlight.set(url, task);
}
