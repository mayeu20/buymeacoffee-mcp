# buymeacoffee-mcp

Read your own Buy Me a Coffee account from an AI assistant. This MCP server runs over stdio and uses the official read-only API.

See recent supporters, Extras purchases, memberships, and totals by currency. This project is independent and not affiliated with Buy Me a Coffee. Buy Me a Coffee is a trademark of its owner.

## Tools

| Tool | What it returns | Arguments |
| --- | --- | --- |
| `list_supporters` | Recent one-off supports, newest first | `limit` (20), `since`, `include_emails` (false), `max_pages` (5) |
| `list_extra_purchases` | Recent Extras purchases | `limit` (20), `since`, `include_emails` (false), `max_pages` (5) |
| `list_subscriptions` | Membership records or an empty result with a message | `include_emails` (false), `max_pages` (5) |
| `summary` | Supports and Extras totals by currency, excluding refunds and revoked purchases | `days` (30), `max_pages` (10) |

`limit` accepts 1 to 100. `days` accepts 1 to 365. `since` accepts an ISO date or a timestamp with a timezone. `max_pages` accepts 1 to 20 per endpoint. Requests are spaced at least one second apart. List results report `has_more`. Subscriptions and summaries return an error if the page cap leaves data unread. Missing normalized fields are `null`.

## Getting a token

Open the [Buy Me a Coffee developer dashboard](https://developers.buymeacoffee.com/). Select Login and sign in with your creator account. In the developer dashboard, select "generate my token", give it a name, and select "generate". Copy the token into your client's `BMAC_TOKEN` setting.

## Claude Desktop

Use `node` 20 or newer. Add this entry to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "buymeacoffee": {
      "command": "npx",
      "args": ["-y", "buymeacoffee-mcp"],
      "env": { "BMAC_TOKEN": "..." }
    }
  }
}
```

Restart Claude Desktop after saving.

## Claude Code

```sh
claude mcp add buymeacoffee -e BMAC_TOKEN=... -- npx -y buymeacoffee-mcp
```

Replace `...` with your token.

## Cursor

Add this to your Cursor MCP configuration:

```json
{
  "mcpServers": {
    "buymeacoffee": {
      "command": "npx",
      "args": ["-y", "buymeacoffee-mcp"],
      "env": { "BMAC_TOKEN": "..." }
    }
  }
}
```

## Codex CLI

```sh
codex mcp add buymeacoffee --env BMAC_TOKEN=... -- npx -y buymeacoffee-mcp
```

Replace `...` with your token.

## Privacy

Emails are redacted by default as `j***@example.com`, including emails in notes and nested records. Set `include_emails: true` only when you need full addresses. This is data from the account owner's account and should be handled accordingly.

The server reads the token only from `BMAC_TOKEN`. It stays in the local process and is sent only to `developers.buymeacoffee.com` for authentication. The server contacts no other host, writes no files, and logs nothing. Tool results go to your assistant. There is no telemetry.

## HTTP 403 and client fingerprints

The API can reject a client fingerprint with HTTP 403 and error code 1010. This may be a client-fingerprint block rather than a bad token. The server sends a browser-like User-Agent on every request. If a block persists, try again later. HTTP 429 means the API has throttled requests.

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm dev
npm pack --dry-run
```

Tests use synthetic fixtures and a local HTTP server. The live test is skipped unless both `BMAC_LIVE=1` and `BMAC_TOKEN` are set. It uses your real account and makes three read-only requests. Never put a token in a tracked file.

`scripts/probe-shape.mjs` prints the API response shape without values, for verifying against a real account.

The API documentation is marked unmaintained. Field mappings, date assumptions, and page-cap behavior are recorded in `NOTES.md` in the repository.

## Licence

MIT. Copyright 2026 Mathieu Kessler. See [LICENSE](LICENSE).
