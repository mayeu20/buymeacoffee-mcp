import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiClient, ApiError, type ClientOptions, type Row } from "./client.js";
import { protectJson } from "./redact.js";
import { purchase, summarize, summaryPageStop, supporter, timestamp } from "./summary.js";

export function createServer(options: ClientOptions = {}): McpServer {
  // Kept in step with package.json and server.json by tests/metadata.test.ts. This literal
  // had been stranded at 0.1.1 through 0.1.2: it is what the client reads on connect, so it
  // was the only version a user could see, and it was the wrong one. The fourth version
  // string, in the client's User-Agent, is deliberately NOT tracked here: that header is a
  // known-good fingerprint against a Cloudflare-fronted API that answers 403 to the wrong
  // one, so it is not worth changing for tidiness.
  const server = new McpServer({ name: "buymeacoffee-mcp", version: "0.1.3" });
  const api = new ApiClient(options);
  const emails = z.boolean().default(false).describe(
    'Return supporter email addresses in full instead of redacted. Leave false unless the '
    + 'account owner has asked for the addresses themselves: these are other people\'s '
    + 'contact details, and turning this on puts them into the transcript, and into anything '
    + 'that transcript is later pasted into. Everything else in the record is returned either '
    + 'way, so answering "who supported and how much" never needs this.');
  // Every page is one API request and requests are paced one per second across the whole
  // process, so max_pages is a time budget as much as a size budget. What happens when the
  // cap is reached differs by tool, and a caller cannot guess which, so each passes its own
  // ending: the lists return what they have and flag it, summary refuses to total.
  const pages = (defaultValue: number, onCap: string) => z.number().int().min(1).max(20)
    .default(defaultValue).describe(
      `How many API pages to fetch, 1 to 20, default ${defaultValue}. Page size is set by Buy `
      + 'Me a Coffee, not here. Requests are paced at one per second, so a 20-page walk takes '
      + `about 20 seconds. ${onCap}`);
  const listArgs = {
    limit: z.number().int().min(1).max(100).default(20).describe(
      'Maximum number of rows to return, 1 to 100, newest first. Applied AFTER `since`, so it '
      + 'counts matching rows and not rows read. Walking stops as soon as this many have been '
      + 'collected, which is why a small limit is also the cheapest way to query.'),
    since: z.union([z.string().date(), z.string().datetime({ offset: true })]).optional()
      .describe(
        'Keep only records from this moment onward. Either a date, "2026-09-01", or a full '
        + 'timestamp with an offset, "2026-09-01T00:00:00Z". Filtering happens here after the '
        + 'rows are fetched, not at the API, so reaching further back than `max_pages` covers '
        + 'returns a partial window with `has_more` true rather than an error. A record whose '
        + 'date is missing or unparseable fails the call instead of being dropped silently.'),
    include_emails: emails,
    max_pages: pages(5, 'On reaching the cap the rows found so far are returned with '
      + '`has_more` true; raise it, or narrow with `since`, rather than treating that as the '
      + 'full result.'),
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
    return { returned: page.rows.length, pages_fetched: page.pages_fetched, has_more: page.has_more, supporters: page.rows.map(supporter), ...(page.message === undefined ? {} : { message: page.message }) };
  }));
  server.registerTool("list_extra_purchases", {
    description: "List recent Extras purchases with emails redacted by default. Full emails belong to the account owner and should be handled accordingly when include_emails is true.",
    inputSchema: listArgs, annotations,
  }, (args) => run(args.include_emails, async () => {
    const page = await api.walk("extras", args.max_pages, { limit: args.limit, matches: sinceFilter(args.since, "purchased_on") });
    return { returned: page.rows.length, pages_fetched: page.pages_fetched, has_more: page.has_more, purchases: page.rows.map(purchase), ...(page.message === undefined ? {} : { message: page.message }) };
  }));
  server.registerTool("list_subscriptions", {
    description: "Read memberships as supplied by the API, with emails redacted by default. Full emails belong to the account owner and should be handled accordingly when include_emails is true.",
    inputSchema: {
      include_emails: emails,
      max_pages: pages(5, 'This tool refuses a partial answer: if more pages remain at the '
        + 'cap it returns an error naming the cap rather than an incomplete membership list.'),
    }, annotations,
  }, (args) => run(args.include_emails, async () => {
    const page = await api.walk("subscriptions", args.max_pages);
    if (page.has_more) throw new ApiError("Subscriptions exceed max_pages. Increase max_pages up to 20 to avoid an incomplete result.");
    return { returned: page.rows.length, subscriptions: page.rows, ...(page.message === undefined ? {} : { message: page.message }) };
  }));
  server.registerTool("summary", {
    description: "Total supports and Extras by currency, counting free supports separately and excluding refunds and revoked purchases. Stops after an older page when observed ordering is newest-first, or returns an error if the page cap prevents completion.",
    inputSchema: {
      days: z.number().int().min(1).max(365).default(30).describe(
        'Length of the window in days, 1 to 365, counting back from now. The response repeats '
        + 'the window and the time it was computed, so a total can be read back later without '
        + 'guessing which days it covered.'),
      max_pages: pages(20, 'This tool refuses a partial answer: if either walk still has '
        + 'pages left at the cap it returns an error and no totals, because a total computed '
        + 'over part of the window reads exactly like a real one.'),
    }, annotations,
  }, (args) => run(false, async () => {
    const now = new Date();
    const from = now.getTime() - args.days * 86_400_000;
    const supports = await api.walk("supporters", args.max_pages, { stopAfterPage: summaryPageStop(from, "support_created_on") });
    const extras = await api.walk("extras", args.max_pages, { stopAfterPage: summaryPageStop(from, "purchased_on") });
    if (supports.has_more || extras.has_more) throw new ApiError("Summary is incomplete at max_pages. Increase max_pages up to 20; totals have not been returned.");
    return summarize(supports.rows, extras.rows, args.days, now, supports.pages_fetched + extras.pages_fetched, Boolean(supports.early_stop || extras.early_stop));
  }));
  return server;
}
