# Changelog

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
