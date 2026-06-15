"use client";

import PlayerEmbed from "@/components/PlayerEmbed";
import StatusBadge from "@/components/StatusBadge";
import { useStreamStatus } from "@/components/useStreamStatus";

export default function EmbedPlayer({ publicId }: { publicId: string }) {
  const { status, reloadKey } = useStreamStatus(publicId);

  return (
    <div className="relative h-screen w-screen bg-black">
      <PlayerEmbed
        src={`/api/proxy?id=${encodeURIComponent(publicId)}`}
        reloadKey={reloadKey}
        className="h-full w-full"
      />
      <div className="pointer-events-none absolute right-3 top-3">
        <StatusBadge status={status} />
      </div>
    </div>
  );
}
