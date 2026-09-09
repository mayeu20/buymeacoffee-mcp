import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, API_BASE } from "../src/client.js";
import { fixtureServer } from "./fixture-server.js";

const page = (data: unknown[] = [], next: string | null = null) =>
  Response.json({ current_page: 1, data, next_page_url: next, per_page: 5 });
afterEach(() => vi.unstubAllEnvs());

describe("HTTP client", () => {
  it("walks real fixture pages with bearer auth, User-Agent, and pacing", async () => {
    const fixture = await fixtureServer();
    try {
      const api = new ApiClient({ apiBase: fixture.apiBase, token: "fixture-token" });
      const result = await api.walk("supporters", 5);
      expect(result).toMatchObject({ pages_fetched: 2, has_more: false });
      expect(result.rows).toHaveLength(4);
      expect(fixture.requests.every((r) => r.authorization === "Bearer fixture-token")).toBe(true);
      expect(fixture.requests.every((r) => r.userAgent === "Mozilla/5.0 (compatible; buymeacoffee-mcp/0.1.0)")).toBe(true);
      // Arrival jitter can differ slightly from strictly paced request starts.
      expect(fixture.requests[1]!.time - fixture.requests[0]!.time).toBeGreaterThanOrEqual(980);
    } finally { await fixture.close(); }
  });
  it("caps pagination and limits without tuning per_page", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => page([{ support_id: 1 }, { support_id: 2 }], `${API_BASE}supporters?page=2`));
    const api = new ApiClient({ token: "fixture-token", fetch: fetcher });
    expect(await api.walk("supporters", 1, { limit: 1 })).toMatchObject({ rows: [{ support_id: 1 }], pages_fetched: 1, has_more: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).not.toContain("per_page");
  });
  it("serializes concurrent calls across client instances", async () => {
    const starts: number[] = [];
    const fetcher: typeof fetch = async () => { starts.push(performance.now()); return page(); };
    await Promise.all([
      new ApiClient({ token: "fixture-token", fetch: fetcher }).walk("supporters", 1),
      new ApiClient({ token: "fixture-token", fetch: fetcher }).walk("extras", 1),
    ]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000);
  });
  it.each([
    [401, "unauthorized", "BMAC_TOKEN"],
    [403, "denied", "client-fingerprint block rather than a bad token"],
    [403, "error code: 1010", "Cloudflare 1010"],
    [429, "limit", "throttled"],
    [503, "unavailable", "upstream"],
  ])("maps HTTP %s safely", async (status, body, expected) => {
    const api = new ApiClient({ token: "fixture-token", fetch: async () => new Response(`${body} fixture-token`, { status: Number(status) }) });
    await expect(api.walk("supporters", 1)).rejects.toThrow(String(expected));
  });
  it("never returns transport exception details", async () => {
    const api = new ApiClient({ token: "fixture-token", fetch: async () => { throw new Error("fixture-token"); } });
    await expect(api.walk("supporters", 1)).rejects.toThrow("Could not reach");
  });
  it("rejects missing tokens before sending a request", async () => {
    vi.stubEnv("BMAC_TOKEN", "");
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ApiClient({ fetch: fetcher }).walk("supporters", 1)).rejects.toThrow("Set BMAC_TOKEN");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["supporters", "error"], ["supporters", "message"],
    ["extras", "error"], ["extras", "message"],
    ["subscriptions", "error"], ["subscriptions", "message"],
  ] as const)("accepts empty %s responses under %s", async (endpoint, key) => {
    const message = `No ${endpoint}`;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ [key]: message }));
    const api = new ApiClient({ token: "fixture-token", fetch: fetcher });
    expect(await api.walk(endpoint, 5)).toEqual({ rows: [], has_more: false, pages_fetched: 1, message });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["supporters", "extras", "subscriptions"] as const)("rejects an empty message after collected %s rows", async (endpoint) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([{ payer_name: "Synthetic supporter" }], `${API_BASE}${endpoint}?page=2`))
      .mockResolvedValueOnce(Response.json({ error: `No ${endpoint}` }));
    const api = new ApiClient({ token: "fixture-token", fetch: fetcher });
    await expect(api.walk(endpoint, 5)).rejects.toThrow("unexpected message during pagination");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    "https://example.com/api/v1/supporters?page=2",
    "http://developers.buymeacoffee.com/api/v1/supporters?page=2",
    "https://user:pass@developers.buymeacoffee.com/api/v1/supporters?page=2",
    `${API_BASE}extras?page=2`,
  ])("blocks unsafe pagination %s", async (next) => {
    const fetcher = vi.fn<typeof fetch>(async () => page([], next));
    await expect(new ApiClient({ token: "fixture-token", fetch: fetcher }).walk("supporters", 2)).rejects.toThrow("Unsafe API pagination");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("blocks redirects without following their target", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { Location: "https://example.com" } }));
    await expect(new ApiClient({ token: "fixture-token", fetch: fetcher }).walk("supporters", 1)).rejects.toThrow("Redirects are not followed");
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe("manual");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("detects pagination loops", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => page([], `${API_BASE}supporters`));
    await expect(new ApiClient({ token: "fixture-token", fetch: fetcher }).walk("supporters", 5)).rejects.toThrow("pagination loop");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["not JSON", "[]", '{"data":[1],"next_page_url":null}', '{"data":[]}', '{"error":123}', '{"message":null}', '{"data":null,"error":"No supporters"}'])("rejects malformed API responses %s", async (body) => {
    const api = new ApiClient({ token: "fixture-token", fetch: async () => new Response(body) });
    await expect(api.walk("supporters", 1)).rejects.toThrow(/invalid JSON|unexpected/);
  });
  it("rejects nonofficial base hosts except explicit loopback fixtures", () => {
    expect(() => new ApiClient({ apiBase: "https://example.com/api/v1/" })).toThrow("host is not allowed");
  });
});
