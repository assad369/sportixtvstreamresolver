import connectDB from "@/lib/db";
import { Stream, type IStream } from "@/models/Stream";
import { resolveWithRetry, StreamNotFoundError } from "@/lib/resolver";
import { getCached, setCached, invalidateCached, peekCached } from "@/lib/cache";
import type { PlayableStream, StreamHeaders } from "@/types/stream";

const RESOLUTION_TTL_MS =
  Number(process.env.RESOLUTION_TTL_MINUTES ?? "4") * 60 * 1000;

/** The stream exists but the admin has disabled it. → HTTP 403 */
export class StreamDisabledError extends Error {
  constructor() {
    super("This stream is currently disabled.");
    this.name = "StreamDisabledError";
  }
}

/** No stream with this publicId. → HTTP 404 */
export class StreamMissingError extends Error {
  constructor() {
    super("Stream not found.");
    this.name = "StreamMissingError";
  }
}

function toPlayable(
  publicId: string,
  embedUrl: string,
  m3u8Url: string,
  headers: StreamHeaders,
  resolvedAt: number,
): PlayableStream {
  return { publicId, embedUrl, m3u8Url, headers, resolvedAt, status: "active" };
}

async function persistResolution(
  doc: IStream,
  m3u8Url: string,
  headers: StreamHeaders,
): Promise<PlayableStream> {
  const resolvedAt = Date.now();
  doc.lastM3u8Url = m3u8Url;
  doc.lastHeaders = headers;
  doc.lastResolvedAt = new Date(resolvedAt);
  doc.status = "active";
  await doc.save();

  const playable = toPlayable(
    doc.publicId,
    doc.embedUrl,
    m3u8Url,
    headers,
    resolvedAt,
  );
  setCached(playable);
  return playable;
}

/**
 * Return a playable (resolved) stream for a public ID, resolving on demand.
 * Throws StreamMissingError / StreamDisabledError for the route to map to
 * 404 / 403.
 */
export async function getPlayableStream(
  publicId: string,
): Promise<PlayableStream> {
  // 1) Hot cache (fresh + active).
  const cached = getCached(publicId);
  if (cached) return cached;

  // 2) Load the document.
  await connectDB();
  const doc = await Stream.findOne({ publicId });
  if (!doc) throw new StreamMissingError();
  if (!doc.enabled) {
    invalidateCached(publicId);
    throw new StreamDisabledError();
  }

  // 3) Reuse a recent resolution stored on the document.
  if (
    doc.lastM3u8Url &&
    doc.lastHeaders &&
    doc.lastResolvedAt &&
    Date.now() - doc.lastResolvedAt.getTime() < RESOLUTION_TTL_MS
  ) {
    const playable = toPlayable(
      doc.publicId,
      doc.embedUrl,
      doc.lastM3u8Url,
      doc.lastHeaders,
      doc.lastResolvedAt.getTime(),
    );
    setCached(playable);
    return playable;
  }

  // 4) Resolve fresh.
  return resolveAndPersist(doc);
}

/** Force a re-resolve (called by the proxy when the origin returns 403/404). */
export async function refreshStream(publicId: string): Promise<PlayableStream> {
  await connectDB();
  const doc = await Stream.findOne({ publicId });
  if (!doc) throw new StreamMissingError();
  if (!doc.enabled) {
    invalidateCached(publicId);
    throw new StreamDisabledError();
  }
  return resolveAndPersist(doc);
}

async function resolveAndPersist(doc: IStream): Promise<PlayableStream> {
  try {
    const { m3u8Url, headers } = await resolveWithRetry(doc.embedUrl);
    return await persistResolution(doc, m3u8Url, headers);
  } catch (err) {
    doc.status = "failed";
    await doc.save().catch(() => {});
    invalidateCached(doc.publicId);
    throw err instanceof StreamNotFoundError ? err : new StreamNotFoundError();
  }
}

/** Read the headers we should replay for a stream (cache, else document). */
export async function getStreamHeaders(
  publicId: string,
): Promise<StreamHeaders | undefined> {
  const cached = peekCached(publicId);
  if (cached) return cached.headers;
  await connectDB();
  const doc = await Stream.findOne({ publicId });
  return doc?.lastHeaders ?? undefined;
}
