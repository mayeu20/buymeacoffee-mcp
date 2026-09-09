#!/usr/bin/env node
// Prints the SHAPE of the three Buy Me a Coffee endpoints: HTTP status, top-level keys with
// value types, and for any array of records the row count and the first row's key names.
// It never prints values, so no email, name, amount or token can appear in the output.
const token = process.env.BMAC_TOKEN;
if (!token) { console.error("Set BMAC_TOKEN first."); process.exit(1); }
const base = "https://developers.buymeacoffee.com/api/v1/";
const typeOf = (v) => v === null ? "null" : Array.isArray(v) ? `array(${v.length})` : typeof v;
for (const endpoint of ["supporters", "extras", "subscriptions?status=all", "subscriptions"]) {
  const res = await fetch(new URL(endpoint, base), {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "Mozilla/5.0 (compatible; buymeacoffee-mcp/0.1.0)", Accept: "application/json" },
    redirect: "manual",
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = undefined; }
  console.log(`\n== ${endpoint} -> HTTP ${res.status}, content-type ${res.headers.get("content-type")}`);
  if (body === undefined) { console.log(`  non-JSON body, ${text.length} chars, starts with: ${JSON.stringify(text.slice(0, 40))}`); continue; }
  if (Array.isArray(body)) {
    console.log(`  top level: array(${body.length})`);
    if (body[0] && typeof body[0] === "object") console.log(`  first row keys: ${Object.keys(body[0]).join(", ")}`);
    continue;
  }
  if (typeof body !== "object" || body === null) { console.log(`  top level: ${typeOf(body)}`); continue; }
  for (const [k, v] of Object.entries(body)) {
    let note = typeOf(v);
    if (k === "message" || k === "error" || k === "status") note += ` = ${JSON.stringify(v)}`;
    console.log(`  ${k}: ${note}`);
    if (Array.isArray(v) && v[0] && typeof v[0] === "object") {
      console.log(`    first row keys: ${Object.keys(v[0]).join(", ")}`);
      for (const [rk, rv] of Object.entries(v[0])) if (rv && typeof rv === "object" && !Array.isArray(rv)) console.log(`    nested ${rk} keys: ${Object.keys(rv).join(", ")}`);
    }
    if (v && typeof v === "object" && !Array.isArray(v) && k === "data") console.log(`    data object keys: ${Object.keys(v).slice(0, 12).join(", ")}`);
  }
}
