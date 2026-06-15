import { type NextRequest } from "next/server";
import { peekCached } from "@/lib/cache";
import { subscribe } from "@/lib/sse";
import { withCors } from "@/lib/cors";
import type { StatusEvent } from "@/types/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const publicId = request.nextUrl.searchParams.get("id");
  if (!publicId) {
    return new Response("Missing id parameter.", {
      status: 400,
      headers: withCors(),
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: StatusEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      // Emit current status immediately so the client syncs on connect.
      const cached = peekCached(publicId);
      send({
        status: cached?.status ?? "active",
        at: Date.now(),
      });

      const unsubscribe = subscribe(publicId, send);

      // Heartbeat keeps the connection alive through proxies/timeouts.
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: withCors({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    }),
  });
}
