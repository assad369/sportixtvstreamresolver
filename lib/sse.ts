import type { StatusEvent } from "@/types/stream";

// Tiny pub/sub bus connecting the proxy/resolver (publishers) to the
// /api/status SSE route (subscribers). Kept on globalThis so dev hot-reloads
// don't orphan live subscribers.

type Subscriber = (event: StatusEvent) => void;

const globalForSse = globalThis as unknown as {
  __streamStatusBus?: Map<string, Set<Subscriber>>;
};

const channels: Map<string, Set<Subscriber>> =
  globalForSse.__streamStatusBus ?? new Map<string, Set<Subscriber>>();

if (!globalForSse.__streamStatusBus) {
  globalForSse.__streamStatusBus = channels;
}

export function subscribe(sessionId: string, fn: Subscriber): () => void {
  let set = channels.get(sessionId);
  if (!set) {
    set = new Set<Subscriber>();
    channels.set(sessionId, set);
  }
  set.add(fn);

  return () => {
    const current = channels.get(sessionId);
    if (!current) return;
    current.delete(fn);
    if (current.size === 0) channels.delete(sessionId);
  };
}

export function emitStatus(sessionId: string, event: StatusEvent): void {
  const set = channels.get(sessionId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // A broken subscriber must not stop the others.
    }
  }
}
