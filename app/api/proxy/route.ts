import { NextResponse, type NextRequest, after } from "next/server";
import {
  getPlayableStream,
  refreshStream,
  StreamDisabledError,
  StreamMissingError,
} from "@/lib/streamService";
import { emitStatus } from "@/lib/sse";
import { fetchPlaylist, rewritePlaylist, TokenExpiredError } from "@/lib/proxy";
import { prefetchSegment } from "@/lib/segmentCache";
import { withCors, corsPreflight } from "@/lib/cors";
import type { PlayableStream } from "@/types/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Segments withheld from the live edge of the served playlist, giving
// background prefetch a head start so players never hit a cold origin fetch.
// 0 disables holdback while leaving prefetch on (useful for isolating impact).
const HOLDBACK_SEGMENT_COUNT = Number(
  process.env.HOLDBACK_SEGMENT_COUNT ?? "1",
);

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const publicId = params.get("id");
  // `src` lets nested/variant playlists be proxied against a specific URL.
  const src = params.get("src");

  if (!publicId) {
    return NextResponse.json(
      { error: "Missing id parameter." },
      { status: 400, headers: withCors() },
    );
  }

  let stream: PlayableStream;
  try {
    stream = await getPlayableStream(publicId);
  } catch (err) {
    return mapStreamError(err);
  }

  const targetUrl = src ?? stream.m3u8Url;
  let body: string;
  let baseUrl = targetUrl;

  try {
    body = await fetchPlaylist(targetUrl, { headers: stream.headers });
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      // Token expired — silently re-resolve from the stored embed URL.
      emitStatus(publicId, {
        status: "refreshing",
        message: "Token expired, refreshing stream…",
        at: Date.now(),
      });
      try {
        stream = await refreshStream(publicId);
        emitStatus(publicId, {
          status: "active",
          message: "Stream refreshed.",
          at: Date.now(),
        });
        // A stale `src` (old variant URL) no longer applies after a refresh —
        // fall back to the freshly resolved master playlist.
        baseUrl = stream.m3u8Url;
        body = await fetchPlaylist(stream.m3u8Url, { headers: stream.headers });
      } catch (refreshErr) {
        emitStatus(publicId, {
          status: "failed",
          message: "Stream refresh failed.",
          at: Date.now(),
        });
        if (
          refreshErr instanceof StreamMissingError ||
          refreshErr instanceof StreamDisabledError
        ) {
          return mapStreamError(refreshErr);
        }
        return NextResponse.json(
          { error: "Stream refresh failed. Please try again." },
          { status: 502, headers: withCors() },
        );
      }
    } else {
      return NextResponse.json(
        { error: "Failed to fetch playlist." },
        { status: 502, headers: withCors() },
      );
    }
  }

  const { body: rewritten, segmentUris, isMaster, isVod } = rewritePlaylist(
    body,
    baseUrl,
    publicId,
    { holdbackCount: HOLDBACK_SEGMENT_COUNT },
  );

  if (!isMaster && !isVod && segmentUris.length > 0) {
    // Capture headers now (post any token refresh above) and warm the
    // segment cache after the response is sent, so players never pay
    // cold origin latency for segments that are about to enter the window.
    const headersForPrefetch = stream.headers;
    after(() => {
      for (const uri of segmentUris) prefetchSegment(uri, headersForPrefetch);
    });
  }

  return new NextResponse(rewritten, {
    status: 200,
    headers: withCors({
      "Content-Type": "application/vnd.apple.mpegurl",
      // Live playlists advance every few seconds, so they must stay fresh — but
      // a 1s edge TTL lets the CDN collapse the burst of near-simultaneous
      // requests from many concurrent viewers into a single origin hit, with
      // negligible staleness. Do NOT raise this for live streams.
      "Cache-Control": "public, max-age=0, s-maxage=1",
    }),
  });
}

function mapStreamError(err: unknown): NextResponse {
  if (err instanceof StreamDisabledError) {
    return NextResponse.json(
      { error: "This stream is currently disabled." },
      { status: 403, headers: withCors() },
    );
  }
  if (err instanceof StreamMissingError) {
    return NextResponse.json(
      { error: "Stream not found." },
      { status: 404, headers: withCors() },
    );
  }
  return NextResponse.json(
    { error: "Could not load stream." },
    { status: 502, headers: withCors() },
  );
}
