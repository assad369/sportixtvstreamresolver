import { spawn } from "node:child_process";
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
