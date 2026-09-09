import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import { fixture, fixtureServer, type FixturePage } from "./fixture-server.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function connect(supporters: FixturePage[], extras?: FixturePage[]) {
  const http = await fixtureServer({ supporters, ...(extras ? { extras } : {}) });
  const server = createServer({ apiBase: http.apiBase, token: "fixture-token" });
  const client = new Client({ name: "window-fixture-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, requests: http.requests, close: async () => {
    await client.close();
    await server.close();
    await http.close();
  } };
}

it("stops both ordered endpoints after page 3, including at the page cap", async () => {
  const supporters: FixturePage[] = await fixture("supporters-window");
  const template = (await fixture("extras-1")).data[0];
  const extras = supporters.map((page) => ({ ...page,
    next_page_url: page.next_page_url?.replace("supporters", "extras") ?? null,
    data: page.data.map((row) => ({ ...template, purchased_on: row.support_created_on })),
  }));
  const session = await connect(supporters, extras);
  try {
    const tools = await session.client.listTools();
    expect(tools.tools.find((tool) => tool.name === "summary")?.inputSchema.properties?.max_pages)
      .toMatchObject({ default: 20, maximum: 20 });
    const result = await session.client.callTool({ name: "summary", arguments: { max_pages: 3 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      supports: { count: 10, free_count: 2, total_by_currency: { USD: 40 } },
      extras: { count: 10, total_by_currency: { USD: 80 } },
      pages_fetched: 6, early_stop: true,
    });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent, null, 2) }]);
    for (const endpoint of ["supporters", "extras"]) {
      expect(session.requests.filter((r) => r.url.includes(endpoint)).map((r) => r.url)).toEqual([
        `/api/v1/${endpoint}`, `/api/v1/${endpoint}?page=2`, `/api/v1/${endpoint}?page=3`,
      ]);
    }
  } finally { await session.close(); }
}, 15_000);

it.each(["within a page", "across pages"])("keeps walking after order breaks %s, and completes on a short final page", async (where) => {
  const pages: FixturePage[] = await fixture("supporters-window");
  if (where === "within a page") {
    // The cutoff page is entirely old but contains a timestamp increase.
    pages[2]!.data[1]!.support_created_on = "2026-08-09 10:00:00";
  } else {
    pages[1]!.data[0]!.support_created_on = "2026-09-08 10:00:00";
  }
  const session = await connect(pages);
  try {
    const capped = await session.client.callTool({ name: "summary", arguments: { max_pages: 3 } });
    expect(capped.isError).toBe(true);
    expect(capped.structuredContent).toEqual({ error: expect.stringContaining("incomplete at max_pages") });
    expect(session.requests.filter((r) => r.url.includes("supporters"))).toHaveLength(3);

    const complete = await session.client.callTool({ name: "summary", arguments: { max_pages: 4 } });
    expect(complete.isError).not.toBe(true);
    expect(complete.structuredContent).toMatchObject({
      supports: { count: 10, free_count: 2, total_by_currency: { USD: 40 } },
      pages_fetched: 5, early_stop: false,
    });
    expect(session.requests.filter((r) => r.url.includes("supporters")).at(-1)?.url).toBe("/api/v1/supporters?page=4");
    expect(pages[3]!.data.length).toBeLessThan(pages[2]!.data.length);
    expect(pages[3]!.next_page_url).toBeNull();
  } finally { await session.close(); }
}, 20_000);

it("preserves list pagination across the older pages", async () => {
  const session = await connect(await fixture("supporters-window"));
  try {
    const result = await session.client.callTool({ name: "list_supporters", arguments: { since: "2026-08-10T12:00:00Z" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ returned: 10, pages_fetched: 4, has_more: false });
    expect(result.structuredContent).not.toHaveProperty("early_stop");
    expect(session.requests).toHaveLength(4);
  } finally { await session.close(); }
}, 10_000);
