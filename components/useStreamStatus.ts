"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionStatus, StatusEvent } from "@/types/stream";

/**
 * Subscribe to /api/status SSE for a stream (publicId). Returns the live status
 * plus a `reloadKey` that increments whenever the stream is refreshed, so the
 * player can reconnect to a freshly-tokenised playlist.
 */
export function useStreamStatus(publicId: string | null) {
  const [status, setStatus] = useState<SessionStatus>("active");
  const [reloadKey, setReloadKey] = useState(0);
  const wasRefreshing = useRef(false);

  useEffect(() => {
    if (!publicId) return;

    const es = new EventSource(
      `/api/status?id=${encodeURIComponent(publicId)}`,
    );

    es.onmessage = (e) => {
      try {
        const event: StatusEvent = JSON.parse(e.data);
        setStatus(event.status);
        // A refreshing → active transition means a new token is live.
        if (event.status === "refreshing") {
          wasRefreshing.current = true;
        } else if (event.status === "active" && wasRefreshing.current) {
          wasRefreshing.current = false;
          setReloadKey((k) => k + 1);
        }
      } catch {
        /* ignore malformed events */
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };

    return () => es.close();
  }, [publicId]);

  return { status, reloadKey };
}
