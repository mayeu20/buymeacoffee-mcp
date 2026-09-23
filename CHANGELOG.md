# Changelog

## 0.1.3 (2026-09-23)

- Describe every input field of every tool. All 12 arguments across the four tools now carry a schema description, so a client shows the caller what a field means and how it fails.
- The descriptions name the differences a caller cannot guess: `since` filters after fetching rather than at the API, so too little `max_pages` gives a partial window and not an error; `limit` counts matching rows and not rows read; the two list tools return a partial result with `has_more` at the page cap while `list_subscriptions` and `summary` refuse and return an error.
- `include_emails` now says in the schema what turning it on does, not just what it returns.
- Report version 0.1.3 on connect. The server had advertised 0.1.1 since that release while npm shipped 0.1.2, and the handshake value is the only version a user can read. The User-Agent's version string is deliberately left alone: it is a known-good fingerprint against an API that answers 403 to the wrong one.
- Add `tests/metadata.test.ts`: every input field must carry a description, the count of fields inspected is asserted so an empty enumeration cannot pass, every `include_emails` description must keep its warning, and package.json, server.json and the advertised version must agree.
- No change to any tool's behaviour, arguments, defaults or output.

## 0.1.2 (2026-09-14)

- 0.1.2: devDependency vitest 3.2.x to 4.1.11, clears GHSA-5xrq-8626-4rwp and GHSA-82fw-gwwq-j7x9 reported against the declared dependencies; no runtime change.
- Vitest was never shipped to consumers: it is a devDependency, and `files` includes only `dist`, `README.md`, and `LICENSE`.

## 0.1.1

- summary: stop walking once a whole page is older than the window while the observed order stays newest-first; report `early_stop`; add `supports.free_count` for zero-amount supports; default `max_pages` 20.
- Empty collections: an HTTP 200 body with no `data` and a string under `error` or `message` is an empty collection on all three endpoints; the message is surfaced.
- Fixtures carry the real key sets observed on 9 Sep 2026; `scripts/probe-shape.mjs` prints an account's response shape without values.

## 0.1.0

- Add four read-only tools for supporters, Extras, memberships, and totals.
- Redact emails by default and keep tokens out of tool responses.
- Pace requests, cap pagination, and explain API failures.
- Add fixture, SDK integration, and optional live tests.
