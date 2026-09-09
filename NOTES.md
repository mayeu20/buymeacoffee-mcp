# Notes

## Documentation and field mappings

Read https://developers.buymeacoffee.com/, its README.md, and apireference.md before writing schemas. Both documentation pages are marked unmaintained. Live response shapes for supporters, extras, and subscriptions were verified on 9 Sep 2026 by the account owner's shape probe, as reported by the user. The probe exposed keys and types without personal values. The user subsequently confirmed that all three list tools worked in Claude Code. The revised summary has not been tested against the live account by the agent.

The documentation uses support_id, support_created_on, support_coffee_price, support_coffees, support_currency, support_note, is_refunded, country, payer_email, support_email, supporter_name, and payer_name. The normalized support amount is support_coffee_price multiplied by support_coffees. Prefer a nonempty supporter_name, then payer_name. Prefer payer_email, then support_email. Missing fields become null rather than invented values.

Extras use purchase_id, purchased_on, purchase_amount, purchase_currency, purchase_is_revoked, payer_email, and extra.reward_title. Amount means purchase_amount. It is not total_paid_amount and is not multiplied by quantity. The documentation gives no quantity field and shows no nested support object. The live shape probe confirmed quantity, fk_support_id, and nested extra and support objects. Read quantity when present and return null otherwise. Preserve unknown input fields internally; omit them from normalized list outputs. No values are inferred from nested support. Extras currency comes from purchase_currency; supports currency comes from support_currency.

Subscription records pass through with recursive email redaction. Request status=all, the documented option for active and inactive members. The live probe found HTTP 200 with {"error": "No subscriptions"} and no data key, both with status=all and without it. This differs from the contract's message-key example. All three endpoints accept a response without data and with a string under error or message as an empty collection. A string error takes precedence when both are present. List tools expose the string as message; summary treats the collection as zero rows. The same empty shape for supporters and extras is a compatibility assumption requested by the user, not a live observation. A message after collected rows remains a pagination error.

Supporters and extras returned Laravel pagination envelopes in the live probe. Synthetic fixtures now carry the reported row keys, including support_type, support_hidden, refunded_at, update timestamps, transaction_id, and the full nested extra and support key sets. Fixture values are invented test data, not copied account data or verified live field types. Normalized output fields remain unchanged apart from the optional empty-collection message.

The extras-by-ID documentation shows POST, but this server never uses that endpoint. Only the three documented collection GET endpoints are called.

## Dates, totals, and caps

The documentation shows timestamps without a timezone. Interpret those timestamps as UTC for filtering and totals. This is an explicit assumption pending live verification. Returned list timestamps retain their original strings. since accepts an ISO calendar date or a timestamp with a timezone. Boundaries are inclusive. A summary window is days times 24 hours ending at invocation time. Future rows are excluded.

Records remain open JSON objects instead of speculative record schemas. Amounts accept finite decimal strings or numbers. Totals keep currencies separate and round floating-point noise to eight decimal places. Invalid amounts, currencies, or dates needed for a summary cause a runtime error instead of a misleading total. Null refund and revocation flags mean false, as in the documented examples. True, 1, "1", and "true" mean true.

The user's first live client use on 9 Sep 2026 observed five rows per page, with per_page not tunable. Both supporters and extras were newest-first within and across pages, using support_created_on and purchased_on respectively. Hundreds of zero-amount supports from free downloads caused the old summary to hit its ten-page default before reading the full history.

max_pages applies separately to each endpoint. Summary now defaults to 20 pages per endpoint; other tools default to 5. Every cap is at most 20. Only summary uses date-based early stopping. Each endpoint tracks the previous row timestamp and requires every subsequent timestamp to be less than or equal to it, including across page boundaries. Equal timestamps are valid. Once a whole nonempty page is strictly before the window start, summary stops that endpoint if the ordering observed so far remains valid. A mixed page or a row exactly at the window start does not trigger stopping. Any ordering break or invalid timestamp disables date-based stopping for the rest of that endpoint's walk. Verification covers fetched rows; it cannot prove the order of unseen pages.

A null next_page_url always completes pagination, including a short last page reached exactly at max_pages. A shorter page with a non-null next_page_url is not alone proof that the endpoint is exhausted. If date-based stopping is unavailable and the cap leaves pages unread, summary retains the incomplete-result error. The result's early_stop is true if either endpoint skipped remaining pages after the date cutoff. Normal completion at a null next_page_url gives early_stop=false unless the other endpoint stopped by date. pages_fetched includes every fetched page across both endpoints, including the older page used to establish the cutoff. List pagination and subscription cap handling are unchanged.

supports.count includes both paid and free non-refunded supports within the window. supports.free_count counts the subset with normalized amount zero, including free downloads. Refunded, older, and future records do not contribute to free_count. Paid currency totals are unchanged. Empty histories return zero counts.

## Transport and privacy

One process-wide queue spaces request starts by at least one second, including concurrent tools and failures. Requests time out after 30 seconds. There are no automatic retries. Cloudflare 403 responses containing 1010 are identified as fingerprint blocks. Other 403 responses mention both token access and possible fingerprint blocking.

Redirects are disabled. Pagination must remain on the configured origin and the same collection path. Production uses only https://developers.buymeacoffee.com. Explicit apiBase injection allows loopback HTTP fixture servers for tests. token and fetch injection are programmatic test seams. The executable reads only BMAC_TOKEN and has no host or token command-line options.

Email protection covers strings and keys recursively, including notes and nested passthrough records. Malformed email fields are fully redacted. Full emails require include_emails=true. The token is also removed from returned strings if an upstream response happens to echo it. Error bodies and transport exception text are never returned or logged. Standard output carries only MCP protocol messages.

## Verification and packaging

The Codex CLI help confirms --env <KEY=VALUE>. README commands use that flag. The README describes the Cloudflare 403 behavior without naming that service, to honor its allowed-brand restriction.

Only the specified runtime and development dependencies are used. The lockfile is included in the repository. Installs use temporary store and cache locations under /tmp through command-line settings, with no repository .npmrc. Runtime performs no disk writes. Test fixtures are synthetic and are excluded from the npm package, along with source, tests, this file, and the changelog.

The build clears generated dist output and compiles src/index.ts and its imports. This keeps unrelated duplicate source files and stale generated copies out of the npm package. Existing untracked duplicate files outside dist are left untouched.

The optional live test requires BMAC_LIVE=1 and BMAC_TOKEN. It is skipped in this agent's run. The user's first client use confirmed the list tools and exposed the summary page-cap failure described above. No credentials were read or used by the agent. No package was published and no GitHub resource was created.
