"use client";

import { useEffect, useRef } from "react";
import Hls from "hls.js";

interface PlayerEmbedProps {
  /** Proxy playlist URL, e.g. /api/proxy?id=abc123 */
  src: string;
  /** Bump this to force the player to reload (e.g. after a token refresh). */
  reloadKey?: number;
  className?: string;
}

export default function PlayerEmbed({
  src,
  reloadKey = 0,
  className,
}: PlayerEmbedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | undefined;

    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          /* autoplay may be blocked until user interaction */
        });
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal || !hls) return;
        // Try to recover from transient network/media errors before giving up.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / iOS: native HLS.
      video.src = src;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => {});
      });
    }

    return () => {
      hls?.destroy();
    };
  }, [src, reloadKey]);

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      className={className ?? "w-full h-full bg-black"}
    />
  );
}
