import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import type { StreamHeaders } from "@/types/stream";

/**
 * Why curl instead of fetch():
 * The strmd.st-style origins sit behind a WAF that blocks on the client's TLS
 * fingerprint (JA3). Node's TLS stack — undici `fetch`, `node:https`, and even
 * Playwright's `APIRequestContext` — is on its blocklist and gets a 403, while
 * curl's and a real browser's fingerprints are allowed. Empirically, byte-
 * identical headers from the same IP return 200 via curl and 403 via undici.
 * Shelling out to curl is the reliable way to replay the player's requests.
 */

export interface CurlResult {
  status: number;
  body: Buffer;
  contentType: string | null;
}

export function curlFetch(
  url: string,
  headers: StreamHeaders,
  opts: { range?: string } = {},
): Promise<CurlResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS", // silent, but surface transport errors on stderr
      "-o",
      "-", // body → stdout
      // Write the status code and content-type to stderr so they don't
      // contaminate the binary body on stdout. (%{stderr} needs curl ≥ 7.63.)
      "-w",
      "%{stderr}STATUS:%{http_code} CT:%{content_type}",
      "-H",
      `Referer: ${headers.referer}`,
      "-H",
      `Origin: ${headers.origin}`,
      "-H",
      `User-Agent: ${headers.userAgent}`,
      "-H",
      "Accept: */*",
    ];
    if (opts.range) args.push("-H", `Range: ${opts.range}`);
    args.push(url);

    const child = spawn("curl", args);
    const out: Buffer[] = [];
    let err = "";

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject); // e.g. curl not installed (ENOENT)
    child.on("close", () => {
      const statusMatch = err.match(/STATUS:(\d{3})/);
      const ctMatch = err.match(/CT:([^\s]+)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      const contentType =
        ctMatch && ctMatch[1] && ctMatch[1] !== "(null)" ? ctMatch[1] : null;
      resolve({ status, body: Buffer.concat(out), contentType });
    });
  });
}

export interface CurlStreamResult {
  status: number;
  /** Origin Content-Length, if advertised (absent for chunked responses). */
  contentLength: string | null;
  /** Origin Content-Range, for 206 byte-range responses. */
  contentRange: string | null;
  /** Origin Accept-Ranges, for 206 byte-range responses. */
  acceptRanges: string | null;
  /** Web stream of the body bytes — piped from curl's stdout, never buffered. */
  stream: ReadableStream<Uint8Array>;
}

/**
 * Like {@link curlFetch} but streams the body straight through instead of
 * buffering it. We ask curl to include the response headers inline at the front
 * of stdout (`-i`), parse the header block off the stream prefix, push the
 * remaining body bytes back, and hand back curl's stdout as a web ReadableStream.
 * This pipelines the two hops (origin→server and server→player) so the player's
 * time-to-first-byte is the origin's TTFB, not the full segment download time —
 * the key fix for proxied-stream buffering.
 *
 * `-i` is used instead of `-D /dev/stderr` because the latter makes curl *open*
 * that path for writing, which fails in some containers (e.g. Railway) and 502s
 * every segment.
 *
 * Use this for segment bytes. Playlists still use the buffered curlFetch because
 * their URIs must be rewritten before serving.
 */
export function curlStream(
  url: string,
  headers: StreamHeaders,
  opts: { range?: string } = {},
): Promise<CurlStreamResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "--tcp-nodelay",
      "--connect-timeout",
      "8",
      "-i", // include response headers at the front of stdout
      "-H",
      `Referer: ${headers.referer}`,
      "-H",
      `Origin: ${headers.origin}`,
      "-H",
      `User-Agent: ${headers.userAgent}`,
      "-H",
      "Accept: */*",
    ];
    if (opts.range) args.push("-H", `Range: ${opts.range}`);
    args.push(url);

    const child = spawn("curl", args);
    let head: Buffer = Buffer.alloc(0);
    let err = "";
    let settled = false;

    child.on("error", (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e); // e.g. curl not installed (ENOENT)
    });

    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));

    const onData = (chunk: Buffer) => {
      if (settled) return;
      head = head.length === 0 ? chunk : Buffer.concat([head, chunk]);

      // The header block ends at the first blank line. Buffer stdout until we
      // see it, then everything after the boundary is body.
      let boundary = head.indexOf("\r\n\r\n");
      let sepLen = 4;
      if (boundary === -1) {
        boundary = head.indexOf("\n\n");
        sepLen = 2;
      }
      if (boundary === -1) return; // header block not complete yet

      const lines = head.subarray(0, boundary).toString("utf8").split(/\r?\n/);
      const leftover = head.subarray(boundary + sepLen);

      const statusMatch = (lines[0] ?? "").match(/HTTP\/[\d.]+\s+(\d{3})/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      const header = (name: string): string | null => {
        const re = new RegExp(`^${name}:\\s*(.+)$`, "i");
        for (const line of lines.slice(1)) {
          const m = line.match(re);
          if (m && m[1]) return m[1].trim();
        }
        return null;
      };

      settled = true;
      child.stdout.removeListener("data", onData);
      // Push the body bytes already read back onto the stream so toWeb emits
      // them first, then the rest of stdout — backpressure preserved.
      if (leftover.length > 0) child.stdout.unshift(leftover);

      resolve({
        status,
        contentLength: header("Content-Length"),
        contentRange: header("Content-Range"),
        acceptRanges: header("Accept-Ranges"),
        stream: Readable.toWeb(
          child.stdout,
        ) as unknown as ReadableStream<Uint8Array>,
      });
    };
    child.stdout.on("data", onData);

    // curl exited before a full header block — connection failure, DNS, etc.
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `curl exited (${code}) before response headers: ${err.trim()}`,
        ),
      );
    });
  });
}
