import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import connectDB from "@/lib/db";
import { Stream } from "@/models/Stream";
import { resolveWithRetry, StreamNotFoundError } from "@/lib/resolver";
import { setCached } from "@/lib/cache";
import { createStreamSchema } from "@/lib/validations/stream";
import { generatePublicId, toStreamDTO } from "@/lib/streamUtils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminApi();
  } catch (res) {
    return res as Response;
  }

  await connectDB();
  const docs = await Stream.find().sort({ createdAt: -1 });
  return NextResponse.json({ streams: docs.map(toStreamDTO) });
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireAdminApi();
  } catch (res) {
    return res as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createStreamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // Resolve once up front to validate the embed actually yields a stream.
  let m3u8Url: string;
  let headers;
  try {
    const result = await resolveWithRetry(parsed.data.embedUrl);
    m3u8Url = result.m3u8Url;
    headers = result.headers;
  } catch (err) {
    if (err instanceof StreamNotFoundError) {
      return NextResponse.json(
        {
          error:
            "Could not extract a stream from that embed. It may require login or use DRM.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "Resolver failed. Please try again." },
      { status: 500 },
    );
  }

  await connectDB();
  const publicId = generatePublicId();
  const now = new Date();
  const doc = await Stream.create({
    name: parsed.data.name,
    embedUrl: parsed.data.embedUrl,
    publicId,
    enabled: true,
    status: "active",
    lastM3u8Url: m3u8Url,
    lastHeaders: headers,
    lastResolvedAt: now,
    createdBy: session.user.id,
  });

  // Warm the hot cache so the first playback request is instant.
  setCached({
    publicId,
    embedUrl: doc.embedUrl,
    m3u8Url,
    headers,
    resolvedAt: now.getTime(),
    status: "active",
  });

  return NextResponse.json({ stream: toStreamDTO(doc) }, { status: 201 });
}
