import { chromium, type Browser } from "playwright";
import type { ResolveResult, StreamHeaders } from "@/types/stream";

const HEADLESS = (process.env.PLAYWRIGHT_HEADLESS ?? "true") !== "false";
const MAX_RETRIES = Number(process.env.TOKEN_REFRESH_RETRIES ?? "3");
const M3U8_TIMEOUT_MS = 10_000;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const M3U8_RE = /\.m3u8(\?|$)/i;

/** Thrown when no m3u8 request is seen within the timeout. → HTTP 422 */
export class StreamNotFoundError extends Error {
  constructor(message = "Could not extract stream.") {
    super(message);
    this.name = "StreamNotFoundError";
  }
}

// Reuse a single browser across resolves — launching Chromium per request is
// expensive. The browser is parked on globalThis to survive dev hot-reloads.
const globalForBrowser = globalThis as unknown as {
  __resolverBrowser?: Browser;
};

async function getBrowser(): Promise<Browser> {
  const existing = globalForBrowser.__resolverBrowser;
  if (existing && existing.isConnected()) return existing;
  const browser = await chromium.launch({ headless: HEADLESS });
  globalForBrowser.__resolverBrowser = browser;
  return browser;
}

/**
 * Open the embed page in a headless browser and capture the first .m3u8
 * request, along with the headers the player used to fetch it.
 */
export async function resolveStream(embedUrl: string): Promise<ResolveResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: CHROME_UA,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  let resolveHit: ((value: ResolveResult) => void) | undefined;
  const hit = new Promise<ResolveResult>((resolve) => {
    resolveHit = resolve;
  });

  page.on("request", (request) => {
    const url = request.url();
    if (!M3U8_RE.test(url)) return;
    const reqHeaders = request.headers();
    const headers: StreamHeaders = {
      referer: reqHeaders["referer"] ?? embedUrl,
      origin: reqHeaders["origin"] ?? new URL(embedUrl).origin,
      userAgent: reqHeaders["user-agent"] ?? CHROME_UA,
    };
    resolveHit?.({ m3u8Url: url, headers });
  });

  try {
    await page
      .goto(embedUrl, { waitUntil: "domcontentloaded", timeout: M3U8_TIMEOUT_MS })
      .catch(() => {
        // Navigation may "fail" (e.g. player keeps the connection open) while
        // the m3u8 request still fires — don't treat that as fatal yet.
      });

    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), M3U8_TIMEOUT_MS),
    );
    const result = await Promise.race([hit, timeout]);
    if (!result) {
      throw new StreamNotFoundError(
        "Could not extract stream. The embed may require login or use DRM.",
      );
    }
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Resolve the embed with retry + exponential backoff. Persistence is handled
 * by the caller (lib/streamService.ts). Throws after MAX_RETRIES failures.
 */
export async function resolveWithRetry(
  embedUrl: string,
): Promise<ResolveResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await resolveStream(embedUrl);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        const backoff = 500 * 2 ** attempt; // 500ms, 1s, 2s…
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new StreamNotFoundError();
}
