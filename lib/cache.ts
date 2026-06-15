import type { PlayableStream } from "@/types/stream";

// In-memory HOT cache of resolved streams, keyed by publicId. The source of
// truth is MongoDB (the Stream document); this layer just avoids re-resolving
// (and re-hitting Mongo) on every playlist/segment request. Parked on
// globalThis so dev hot-reloads don't wipe it.

const RESOLUTION_TTL_MINUTES = Number(
  process.env.RESOLUTION_TTL_MINUTES ?? "4",
);
const TTL_MS = RESOLUTION_TTL_MINUTES * 60 * 1000;

const globalForCache = globalThis as unknown as {
  __resolvedStreams?: Map<string, PlayableStream>;
};

const cache: Map<string, PlayableStream> =
  globalForCache.__resolvedStreams ?? new Map<string, PlayableStream>();

if (!globalForCache.__resolvedStreams) {
  globalForCache.__resolvedStreams = cache;
}

/** Return the cached resolution only if it is still fresh and active. */
export function getCached(publicId: string): PlayableStream | undefined {
  const entry = cache.get(publicId);
  if (!entry) return undefined;
  if (entry.status !== "active") return undefined;
  if (Date.now() - entry.resolvedAt > TTL_MS) return undefined;
  return entry;
}

/** Get the cached entry regardless of freshness (e.g. to read its headers). */
export function peekCached(publicId: string): PlayableStream | undefined {
  return cache.get(publicId);
}

export function setCached(stream: PlayableStream): void {
  cache.set(stream.publicId, stream);
}

export function invalidateCached(publicId: string): void {
  cache.delete(publicId);
}
