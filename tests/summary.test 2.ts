import { describe, expect, it } from "vitest";
import { parseAmount, purchase, summarize, supporter, timestamp } from "../src/summary.js";
import { fixture } from "./fixture-server.js";

describe("normalization and summary", () => {
  it.each(["3.50", 3.5, " 3.50 "])("parses decimal amount %s", (value) => {
    expect(parseAmount(value)).toBe(3.5);
  });
  it.each(["", "0x10", "1,000", "NaN", Infinity, null, true])("rejects invalid amount %s", (value) => {
    expect(parseAmount(value)).toBeNull();
  });
  it("uses documented names and prices, with null for unknown fields", () => {
    expect(supporter({ payer_name: "Old", supporter_name: "", support_coffee_price: "2.50", support_coffees: 3 }))
      .toMatchObject({ name: "Old", amount: 7.5, id: null, email: null });
    expect(supporter({ supporter_name: "New", payer_name: "Old" }).name).toBe("New");
    expect(purchase({ purchase_amount: "8", total_paid_amount: "10", quantity: 2, extra: { reward_title: "Guide" } }))
      .toMatchObject({ amount: 8, quantity: 2, extra_title: "Guide" });
    expect(purchase({}).quantity).toBeNull();
  });
  it("assumes UTC for timezone-free API timestamps", () => {
    expect(timestamp("2026-09-09 09:00:00")).toBe(Date.parse("2026-09-09T09:00:00Z"));
    expect(timestamp("invalid")).toBeNull();
  });
  it("totals currencies and counts excluded rows inside the window", async () => {
    const supports = [...(await fixture("supporters-1")).data, ...(await fixture("supporters-2")).data];
    const extras = (await fixture("extras-1")).data;
    expect(summarize(supports, extras, 30, new Date("2026-09-09T12:00:00Z"), 3)).toEqual({
      window_days: 30, from: "2026-08-10T12:00:00.000Z", to: "2026-09-09T12:00:00.000Z",
      supports: { count: 2, total_by_currency: { USD: 10, EUR: 3 } },
      extras: { count: 1, total_by_currency: { USD: 8 } },
      excluded: { refunded_supports: 1, revoked_extras: 1 }, pages_fetched: 3,
    });
  });
  it("includes exact boundaries and excludes future rows", () => {
    const row = { support_coffee_price: "0.1", support_coffees: 3, support_currency: "USD" };
    const output = summarize([
      { ...row, support_created_on: "2026-09-08T12:00:00Z" },
      { ...row, support_created_on: "2026-09-09T12:00:00Z" },
      { ...row, support_created_on: "2026-09-09T12:00:01Z" },
    ], [], 1, new Date("2026-09-09T12:00:00Z"), 1);
    expect(output.supports).toEqual({ count: 2, total_by_currency: { USD: 0.6 } });
  });
  it("returns zero totals for empty histories", () => {
    expect(summarize([], [], 30, new Date(), 2).supports).toEqual({ count: 0, total_by_currency: {} });
  });
  it("fails honestly on unusable data", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    expect(() => summarize([{}], [], 1, now, 1)).toThrow("invalid date");
    expect(() => summarize([{ support_created_on: now.toISOString() }], [], 1, now, 1)).toThrow("amount or currency");
  });
});
