import { NextResponse, type NextRequest } from "next/server";
import { getStreamHeaders } from "@/lib/streamService";
import { curlStream } from "@/lib/originFetch";
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
    "Cache-Control": "no-store",
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
