import { NextResponse, type NextRequest } from "next/server";
import { getStreamHeaders } from "@/lib/streamService";
import { curlFetch } from "@/lib/originFetch";
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
    result = await curlFetch(segmentUrl, headers, { range });
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
  const contentType = "video/mp2t";

  return new NextResponse(new Uint8Array(result.body), {
    status: result.status,
    headers: withCors({
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Length": String(result.body.length),
    }),
  });
}
