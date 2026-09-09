import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import { API_BASE, type ClientOptions } from "../src/client.js";
import { fixtureServer } from "./fixture-server.js";

async function connect(options: ClientOptions) {
  const server = createServer(options);
  const client = new Client({ name: "fixture-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("SDK dispatch", () => {
  it("calls every tool through Client and InMemoryTransport against HTTP fixtures", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
    const fixture = await fixtureServer();
    const session = await connect({ apiBase: fixture.apiBase, token: "fixture-token" });
    try {
      const tools = await session.client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["list_supporters", "list_extra_purchases", "list_subscriptions", "summary"]);
      const outputs: Record<string, Record<string, unknown>> = {};
      for (const name of tools.tools.map((tool) => tool.name)) {
        const result = await session.client.callTool({ name, arguments: {} });
        expect(result.isError).not.toBe(true);
        const object = result.structuredContent as Record<string, unknown>;
        expect(result.content).toEqual([{ type: "text", text: JSON.stringify(object, null, 2) }]);
        expect(JSON.stringify(object)).not.toContain("jamie@example.com");
        outputs[name] = object;
      }
      expect(outputs.list_supporters).toMatchObject({ returned: 4, pages_fetched: 2, has_more: false });
      expect(outputs.list_supporters!.supporters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Jamie", email: "j***@example.com", amount: 10 }),
        expect.objectContaining({ name: "Robin", email: "r***@example.com" }),
      ]));
      expect(outputs.list_extra_purchases).toMatchObject({ returned: 3, pages_fetched: 1, has_more: false });
      expect(outputs.list_subscriptions).toEqual({ returned: 0, subscriptions: [], message: "No subscriptions" });
      expect(outputs.summary).toMatchObject({ supports: { count: 2, total_by_currency: { USD: 10, EUR: 3 } }, extras: { count: 1, total_by_currency: { USD: 8 } }, excluded: { refunded_supports: 1, revoked_extras: 1 }, pages_fetched: 3 });
      expect(fixture.requests).toHaveLength(7);
      expect(fixture.requests.find((r) => r.url.includes("subscriptions"))?.url).toContain("status=all");
    } finally { await session.close(); await fixture.close(); }
  }, 20_000);

  it("filters inclusive dates, enforces limits, and supports explicit full emails", async () => {
    const fixture = await fixtureServer();
    const session = await connect({ apiBase: fixture.apiBase, token: "fixture-token" });
    try {
      const output = await session.client.callTool({ name: "list_supporters", arguments: { since: "2026-09-08T08:00:00Z", include_emails: true } });
      expect(output.structuredContent).toMatchObject({ returned: 2, pages_fetched: 2, has_more: false });
      expect(JSON.stringify(output.structuredContent)).toContain("jamie@example.com");
      const limited = await session.client.callTool({ name: "list_extra_purchases", arguments: { limit: 1, since: "2026-09-09" } });
      expect(limited.structuredContent).toMatchObject({ returned: 1, pages_fetched: 1, has_more: false });
      expect(JSON.stringify(limited.structuredContent)).toContain("j***@example.com");
    } finally { await session.close(); await fixture.close(); }
  }, 10_000);

  it("uses the SDK to reject invalid arguments before any fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const session = await connect({ token: "fixture-token", fetch: fetcher });
    try {
      for (const [name, args] of [
        ["list_supporters", { limit: 0 }], ["list_supporters", { limit: 101 }],
        ["list_supporters", { limit: 1.5 }], ["list_supporters", { since: "yesterday" }],
        ["list_supporters", { since: "2026-02-30" }], ["list_extra_purchases", { max_pages: 21 }],
        ["list_subscriptions", { include_emails: "true" }], ["summary", { days: 366 }],
        ["summary", { max_pages: 0 }],
      ] as const) {
        const result = await session.client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain("validation");
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await session.close(); }
  });

  it("returns a clear, matching JSON error for every tool when BMAC_TOKEN is missing", async () => {
    vi.stubEnv("BMAC_TOKEN", "");
    const fetcher = vi.fn<typeof fetch>();
    const session = await connect({ fetch: fetcher });
    try {
      for (const name of ["list_supporters", "list_extra_purchases", "list_subscriptions", "summary"]) {
        const result = await session.client.callTool({ name, arguments: {} });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({ error: expect.stringContaining("Set BMAC_TOKEN") });
        expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent, null, 2) }]);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await session.close(); }
  });

  it("redacts passthrough subscriptions and tokens even with email opt-in", async () => {
    const fetcher: typeof fetch = async () => Response.json({ current_page: 1, data: [
      { subscription_id: 1, payer_email: "jamie@example.com", subscription_message: "fixture-token", nested: { email: "alex@example.com" } },
    ], per_page: 5, next_page_url: null });
    const session = await connect({ token: "fixture-token", fetch: fetcher });
    try {
      for (const include_emails of [false, true]) {
        const result = await session.client.callTool({ name: "list_subscriptions", arguments: { include_emails } });
        expect(JSON.stringify(result.structuredContent)).toContain(include_emails ? "jamie@example.com" : "j***@example.com");
        expect(JSON.stringify(result.structuredContent)).toContain(include_emails ? "alex@example.com" : "a***@example.com");
        expect(JSON.stringify(result)).not.toContain("fixture-token");
      }
    } finally { await session.close(); }
  });

  it("does not present capped summaries or subscriptions as complete", async () => {
    const fetcher: typeof fetch = async (url) => Response.json({ current_page: 1, data: [], per_page: 5, next_page_url: `${API_BASE}${new URL(String(url)).pathname.split("/").pop()}?page=2` });
    const session = await connect({ token: "fixture-token", fetch: fetcher });
    try {
      for (const name of ["summary", "list_subscriptions"]) {
        const result = await session.client.callTool({ name, arguments: { max_pages: 1 } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({ error: expect.stringContaining("max_pages") });
      }
    } finally { await session.close(); }
  }, 10_000);
});
