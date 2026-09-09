import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiClient, ApiError, type ClientOptions, type Row } from "./client.js";
import { protectJson } from "./redact.js";
import { purchase, summarize, supporter, timestamp } from "./summary.js";

export function createServer(options: ClientOptions = {}): McpServer {
  const server = new McpServer({ name: "buymeacoffee-mcp", version: "0.1.0" });
  const api = new ApiClient(options);
  const emails = z.boolean().default(false);
  const pages = (defaultValue: number) => z.number().int().min(1).max(20).default(defaultValue);
  const listArgs = {
    limit: z.number().int().min(1).max(100).default(20),
    since: z.union([z.string().date(), z.string().datetime({ offset: true })]).optional(),
    include_emails: emails,
    max_pages: pages(5),
  };
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const result = (object: Record<string, unknown>, include: boolean, token: string, isError = false): CallToolResult => {
    const safe = protectJson(object, include, token) as Record<string, unknown>;
    return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }], structuredContent: safe, ...(isError ? { isError: true } : {}) };
  };
  const run = async (include: boolean, work: () => Promise<Record<string, unknown>>): Promise<CallToolResult> => {
    let token = "";
    try {
      token = api.getToken();
      return result(await work(), include, token);
    } catch (error) {
      return result({ error: error instanceof ApiError ? error.message : "Unable to process the Buy Me a Coffee response." }, false, token, true);
    }
  };
  const sinceFilter = (since: string | undefined, key: string) => (row: Row): boolean => {
    if (!since) return true;
    const time = timestamp(row[key]);
    if (time === null) throw new ApiError("Cannot filter a record with a missing or invalid date.");
    return time >= Date.parse(since);
  };
  server.registerTool("list_supporters", {
    description: "List recent one-off supporters, newest first, with emails redacted by default. Full emails belong to the account owner and should be handled accordingly when include_emails is true.",
    inputSchema: listArgs, annotations,
  }, (args) => run(args.include_emails, async () => {
    const page = await api.walk("supporters", args.max_pages, { limit: args.limit, matches: sinceFilter(args.since, "support_created_on") });
    return { returned: page.rows.length, pages_fetched: page.pages_fetched, has_more: page.has_more, supporters: page.rows.map(supporter) };
  }));
  server.registerTool("list_extra_purchases", {
    description: "List recent Extras purchases with emails redacted by default. Full emails belong to the account owner and should be handled accordingly when include_emails is true.",
    inputSchema: listArgs, annotations,
  }, (args) => run(args.include_emails, async () => {
    const page = await api.walk("extras", args.max_pages, { limit: args.limit, matches: sinceFilter(args.since, "purchased_on") });
    return { returned: page.rows.length, pages_fetched: page.pages_fetched, has_more: page.has_more, purchases: page.rows.map(purchase) };
  }));
  server.registerTool("list_subscriptions", {
    description: "Read memberships as supplied by the API, with emails redacted by default. Full emails belong to the account owner and should be handled accordingly when include_emails is true.",
    inputSchema: { include_emails: emails, max_pages: pages(5) }, annotations,
  }, (args) => run(args.include_emails, async () => {
    const page = await api.walk("subscriptions", args.max_pages);
    if (page.has_more) throw new ApiError("Subscriptions exceed max_pages. Increase max_pages up to 20 to avoid an incomplete result.");
    return { returned: page.rows.length, subscriptions: page.rows, ...(page.message === undefined ? {} : { message: page.message }) };
  }));
  server.registerTool("summary", {
    description: "Total one-off supports and Extras by currency over a recent window, excluding refunds and revoked purchases. Returns an error if the page cap prevents a complete summary.",
    inputSchema: { days: z.number().int().min(1).max(365).default(30), max_pages: pages(10) }, annotations,
  }, (args) => run(false, async () => {
    const now = new Date();
    const supports = await api.walk("supporters", args.max_pages);
    const extras = await api.walk("extras", args.max_pages);
    if (supports.has_more || extras.has_more) throw new ApiError("Summary is incomplete at max_pages. Increase max_pages up to 20; totals have not been returned.");
    return summarize(supports.rows, extras.rows, args.days, now, supports.pages_fetched + extras.pages_fetched);
  }));
  return server;
}
