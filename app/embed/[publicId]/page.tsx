import connectDB from "@/lib/db";
import { Stream } from "@/models/Stream";
import EmbedPlayer from "./EmbedPlayer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Next 16: dynamic route `params` is a Promise and must be awaited.
export default async function EmbedPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;

  await connectDB();
  const doc = await Stream.findOne({ publicId }).select("enabled").lean();

  if (!doc || !doc.enabled) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black px-6 text-center">
        <p className="text-sm text-white/60">
          Stream unavailable.
        </p>
      </div>
    );
  }

  return <EmbedPlayer publicId={publicId} />;
}
