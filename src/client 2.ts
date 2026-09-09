import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

export const API_BASE = "https://developers.buymeacoffee.com/api/v1/";
export type Row = Record<string, unknown>;
export type Endpoint = "supporters" | "extras" | "subscriptions";
export interface ClientOptions {
  apiBase?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}
export class ApiError extends Error {}
export function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// One queue across all tools and clients in this process, including failed calls.
let queue = Promise.resolve();
let lastStarted = -Infinity;
async function paced<T>(request: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    while (performance.now() - lastStarted < 1000) {
      await sleep(Math.ceil(1000 - (performance.now() - lastStarted)));
    }
    lastStarted = performance.now();
    return request();
  });
  queue = next.then(() => undefined, () => undefined);
  return next;
}

export class ApiClient {
  private readonly base: URL;
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: ClientOptions = {}) {
    this.base = new URL(options.apiBase ?? API_BASE);
    // Only explicit test injection permits a loopback fixture server.
    const official = this.base.origin === new URL(API_BASE).origin;
    const fixture = options.apiBase && this.base.protocol === "http:"
      && ["127.0.0.1", "[::1]", "localhost"].includes(this.base.hostname);
    if ((!official && !fixture) || this.base.username || this.base.password) {
      throw new ApiError("API host is not allowed.");
    }
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  getToken(): string {
    const token = this.options.token ?? process.env.BMAC_TOKEN;
    if (!token?.trim()) {
      throw new ApiError("Missing BMAC_TOKEN. Set BMAC_TOKEN to your Buy Me a Coffee personal access token in the server environment.");
    }
    return token;
  }

  private safeUrl(value: string, endpoint: Endpoint): URL {
    let url: URL;
    try { url = new URL(value, this.base); }
    catch { throw new ApiError("Invalid API pagination URL."); }
    if (url.origin !== this.base.origin || url.username || url.password
      || url.pathname !== new URL(endpoint, this.base).pathname || url.hash) {
      throw new ApiError("Unsafe API pagination URL was blocked.");
    }
    return url;
  }

  private async page(url: URL): Promise<Row> {
    const token = this.getToken();
    return paced(async () => {
      let response: Response;
      let body: string;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "Mozilla/5.0 (compatible; buymeacoffee-mcp/0.1.0)",
            Accept: "application/json",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });
        body = await response.text();
      } catch {
        throw new ApiError("Could not reach the Buy Me a Coffee API. Check your connection or try again after a timeout.");
      }
      if (!response.ok) {
        if (response.status === 403 && /\b1010\b/.test(body)) {
          throw new ApiError("HTTP 403: Cloudflare 1010 client-fingerprint block. This may be a client-fingerprint block rather than a bad token.");
        }
        if (response.status === 401 || response.status === 403) {
          throw new ApiError(`HTTP ${response.status}: Check your BMAC_TOKEN and its access.${response.status === 403 ? " This may be a client-fingerprint block rather than a bad token." : ""}`);
        }
        if (response.status === 429) throw new ApiError("HTTP 429: Buy Me a Coffee throttled this request. Wait before trying again.");
        if (response.status >= 500) throw new ApiError(`HTTP ${response.status}: Buy Me a Coffee upstream error. Try again later.`);
        throw new ApiError(`HTTP ${response.status}: Buy Me a Coffee request failed. Redirects are not followed.`);
      }
      let data: unknown;
      try { data = JSON.parse(body); }
      catch { throw new ApiError("Buy Me a Coffee returned invalid JSON."); }
      if (!isRow(data)) throw new ApiError("Buy Me a Coffee returned an unexpected response.");
      return data;
    });
  }

  async walk(endpoint: Endpoint, maxPages: number, options: {
    limit?: number;
    matches?: (row: Row) => boolean;
  } = {}): Promise<{ rows: Row[]; pages_fetched: number; has_more: boolean; message?: string }> {
    let url = this.safeUrl(endpoint === "subscriptions" ? "subscriptions?status=all" : endpoint, endpoint);
    const seen = new Set<string>();
    const rows: Row[] = [];
    const limit = options.limit ?? Infinity;
    for (let pages = 1; pages <= maxPages; pages++) {
      if (seen.has(url.href)) throw new ApiError("Buy Me a Coffee returned a pagination loop.");
      seen.add(url.href);
      const page = await this.page(url);
      const message = typeof page.error === "string" ? page.error : page.message;
      if (!Object.hasOwn(page, "data") && typeof message === "string") {
        if (rows.length) throw new ApiError("Buy Me a Coffee returned an unexpected message during pagination.");
        return { rows: [], pages_fetched: pages, has_more: false, message };
      }
      if (!Array.isArray(page.data) || !page.data.every(isRow)
        || !(page.next_page_url === null || typeof page.next_page_url === "string")) {
        throw new ApiError("Buy Me a Coffee returned an unexpected pagination response.");
      }
      rows.push(...page.data.filter(options.matches ?? (() => true)));
      const next = page.next_page_url === null ? null : this.safeUrl(page.next_page_url, endpoint);
      if (!next || pages === maxPages || rows.length >= limit) {
        return { rows: rows.slice(0, limit), pages_fetched: pages, has_more: rows.length > limit || next !== null };
      }
      url = next;
    }
    throw new ApiError("No API pages were fetched.");
  }
}
