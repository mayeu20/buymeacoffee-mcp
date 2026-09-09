# Notes

## Documentation and field mappings

Read https://developers.buymeacoffee.com/, its README.md, and apireference.md before writing schemas. Both documentation pages are marked unmaintained. Live behavior remains unverified because no token was available.

The documentation uses support_id, support_created_on, support_coffee_price, support_coffees, support_currency, support_note, is_refunded, country, payer_email, support_email, supporter_name, and payer_name. The normalized support amount is support_coffee_price multiplied by support_coffees. Prefer a nonempty supporter_name, then payer_name. Prefer payer_email, then support_email. Missing fields become null rather than invented values.

Extras use purchase_id, purchased_on, purchase_amount, purchase_currency, purchase_is_revoked, payer_email, and extra.reward_title. Amount means purchase_amount. It is not total_paid_amount and is not multiplied by quantity. The documentation gives no quantity field and shows no nested support object. The contract explicitly supplies quantity and support as observed fields. Read quantity when present and return null otherwise. Preserve unknown input fields internally; omit them from normalized list outputs. No values are inferred from nested support.

Subscription records pass through with recursive email redaction. Request status=all, the documented option for active and inactive members. Also accept the contract's empty message response, which is not shown in the documentation.

The extras-by-ID documentation shows POST, but this server never uses that endpoint. Only the three documented collection GET endpoints are called.

## Dates, totals, and caps

The documentation shows timestamps without a timezone. Interpret those timestamps as UTC for filtering and totals. This is an explicit assumption pending live verification. Returned list timestamps retain their original strings. since accepts an ISO calendar date or a timestamp with a timezone. Boundaries are inclusive. A summary window is days times 24 hours ending at invocation time. Future rows are excluded.

Records remain open JSON objects instead of speculative record schemas. Amounts accept finite decimal strings or numbers. Totals keep currencies separate and round floating-point noise to eight decimal places. Invalid amounts, currencies, or dates needed for a summary cause a runtime error instead of a misleading total. Null refund and revocation flags mean false, as in the documented examples. True, 1, "1", and "true" mean true.

max_pages applies separately to each endpoint. Summary defaults to 10 pages per endpoint; other tools default to 5. Every cap is at most 20. Walk pages without assuming undocumented date ordering, then filter the requested window. This may read older pages. Summary and subscriptions return a runtime error if the cap leaves unread pages, since their contracted response shapes have no field to disclose partial results. Empty histories return zero counts. List tools preserve API order and expose conservative has_more when a page or row limit leaves unread data.

## Transport and privacy

One process-wide queue spaces request starts by at least one second, including concurrent tools and failures. Requests time out after 30 seconds. There are no automatic retries. Cloudflare 403 responses containing 1010 are identified as fingerprint blocks. Other 403 responses mention both token access and possible fingerprint blocking.

Redirects are disabled. Pagination must remain on the configured origin and the same collection path. Production uses only https://developers.buymeacoffee.com. Explicit apiBase injection allows loopback HTTP fixture servers for tests. token and fetch injection are programmatic test seams. The executable reads only BMAC_TOKEN and has no host or token command-line options.

Email protection covers strings and keys recursively, including notes and nested passthrough records. Malformed email fields are fully redacted. Full emails require include_emails=true. The token is also removed from returned strings if an upstream response happens to echo it. Error bodies and transport exception text are never returned or logged. Standard output carries only MCP protocol messages.

## Verification and packaging

The Codex CLI help confirms --env <KEY=VALUE>. README commands use that flag. The README describes the Cloudflare 403 behavior without naming that service, to honor its allowed-brand restriction.

Only the specified runtime and development dependencies are used. The lockfile is included in the repository. Installs use temporary store and cache locations under /tmp through command-line settings, with no repository .npmrc. Runtime performs no disk writes. Test fixtures are synthetic and are excluded from the npm package, along with source, tests, this file, and the changelog.

The optional live test requires BMAC_LIVE=1 and BMAC_TOKEN. It is skipped in this run. No credentials were read or used. No package was published and no GitHub resource was created.
