import { NextResponse, type NextRequest } from "next/server";
import { getStreamHeaders } from "@/lib/streamService";
import { curlStream } from "@/lib/originFetch";
import { getCachedSegment } from "@/lib/segmentCache";
import { withCors, corsPreflight } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const publicId = params.get("id");
  const seg = params.get("seg");

  if (!publicId || !seg) {
    return NextResponse.json(
      { error: "Missing id or seg parameter." },
      { status: 400, headers: withCors() },
    );
  }

  const headers = await getStreamHeaders(publicId);
  if (!headers) {
    return NextResponse.json(
      { error: "Stream not found or not resolved yet." },
      { status: 404, headers: withCors() },
    );
  }

  const segmentUrl = decodeURIComponent(seg);
  const range = request.headers.get("range") ?? undefined;

  // Range requests (seeking) skip the whole-segment warm cache and always
  // take the cold path below — they're rare in live HLS and the cache only
  // stores complete bodies.
  if (!range) {
    const cached = getCachedSegment(segmentUrl);
    if (cached) {
      return new NextResponse(new Uint8Array(cached.body), {
        status: cached.status,
        headers: withCors({
          "Content-Type": "video/mp2t",
          "Content-Length": String(cached.body.length),
          "Cache-Control":
            "public, max-age=0, s-maxage=60, stale-while-revalidate=30",
        }),
      });
    }
  }

  let result;
  try {
    result = await curlStream(segmentUrl, headers, { range });
  } catch {
    return NextResponse.json(
      { error: "Segment fetch failed." },
      { status: 502, headers: withCors() },
    );
  }

  // 200 (full) and 206 (range) are both success.
  if (result.status !== 200 && result.status !== 206) {
    return NextResponse.json(
      { error: "Segment fetch failed." },
      { status: 502, headers: withCors() },
    );
  }

  // Always serve as MPEG-TS. These origins deliberately mislabel segments
  // (e.g. TikTok CDN returns `image/png` for TS bytes); HLS.js parses the raw
  // bytes and ignores Content-Type, so a stable video/mp2t is the safe choice.
  const responseHeaders: Record<string, string> = {
    "Content-Type": "video/mp2t",
    // A published HLS segment is immutable, so the bytes for a given segment URL
    // never change. We let a CDN (Cloudflare) cache full segments at the edge so
    // concurrent viewers of the same stream are served from cache instead of
    // re-proxying every byte through the origin — this is the main bandwidth
    // saving. `max-age=0` keeps browsers honest while `s-maxage` drives the edge
    // TTL; `stale-while-revalidate` smooths over the resolution refresh window.
    // Range (206) responses are left uncached — partial-content caching is
    // fiddly and full-segment GETs are the common, high-volume path.
    "Cache-Control":
      result.status === 206
        ? "no-store"
        : "public, max-age=0, s-maxage=60, stale-while-revalidate=30",
  };
  // Forward length/range from origin when known. We stream the body through
  // rather than buffering it, so Content-Length is only set when the origin
  // advertised it; otherwise the response is chunked, which HLS.js handles.
  if (result.contentLength) {
    responseHeaders["Content-Length"] = result.contentLength;
  }
  if (result.status === 206) {
    if (result.contentRange) {
      responseHeaders["Content-Range"] = result.contentRange;
    }
    responseHeaders["Accept-Ranges"] = result.acceptRanges ?? "bytes";
  }

  return new NextResponse(result.stream, {
    status: result.status,
    headers: withCors(responseHeaders),
  });
}
