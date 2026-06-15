import { NextResponse, type NextRequest } from "next/server";
import { isValidObjectId } from "mongoose";
import { requireAdminApi } from "@/lib/auth-guard";
import connectDB from "@/lib/db";
import { Stream } from "@/models/Stream";
import { invalidateCached } from "@/lib/cache";
import { emitStatus } from "@/lib/sse";
import { updateStreamSchema } from "@/lib/validations/stream";
import { toStreamDTO } from "@/lib/streamUtils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdminApi();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updateStreamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  await connectDB();
  const doc = await Stream.findById(id);
  if (!doc) {
    return NextResponse.json({ error: "Stream not found." }, { status: 404 });
  }

  if (parsed.data.name !== undefined) doc.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) doc.enabled = parsed.data.enabled;
  await doc.save();

  // Any state change invalidates the hot cache; if disabled, drop live players.
  invalidateCached(doc.publicId);
  if (parsed.data.enabled === false) {
    emitStatus(doc.publicId, {
      status: "failed",
      message: "Stream disabled by admin.",
      at: Date.now(),
    });
  }

  return NextResponse.json({ stream: toStreamDTO(doc) });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    await requireAdminApi();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  await connectDB();
  const doc = await Stream.findByIdAndDelete(id);
  if (!doc) {
    return NextResponse.json({ error: "Stream not found." }, { status: 404 });
  }

  invalidateCached(doc.publicId);
  emitStatus(doc.publicId, {
    status: "failed",
    message: "Stream deleted.",
    at: Date.now(),
  });

  return NextResponse.json({ ok: true });
}
