import { ApiError, isRow, type Row } from "./client.js";

export function parseAmount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const id = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" ? value : null;
export const flag = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";

export function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(" ", "T") + "Z" : value;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

export function supporter(row: Row) {
  const price = parseAmount(row.support_coffee_price);
  const coffees = parseAmount(row.support_coffees);
  const amount = price !== null && coffees !== null ? price * coffees : null;
  return {
    id: id(row.support_id),
    name: string(row.supporter_name) || string(row.payer_name),
    email: string(row.payer_email) || string(row.support_email),
    amount: amount !== null && Number.isFinite(amount) ? Number(amount.toFixed(8)) : null,
    currency: string(row.support_currency),
    coffees,
    note: string(row.support_note),
    created_at: string(row.support_created_on),
    refunded: flag(row.is_refunded),
    country: string(row.country),
  };
}

export function purchase(row: Row) {
  return {
    id: id(row.purchase_id),
    purchased_at: string(row.purchased_on),
    amount: parseAmount(row.purchase_amount),
    currency: string(row.purchase_currency),
    quantity: parseAmount(row.quantity),
    email: string(row.payer_email),
    extra_title: isRow(row.extra) ? string(row.extra.reward_title) : null,
    revoked: flag(row.purchase_is_revoked),
  };
}

export function summarize(supporters: Row[], purchases: Row[], days: number, now: Date, pagesFetched: number) {
  const to = now.getTime();
  const from = to - days * 86_400_000;
  const supports = { count: 0, total_by_currency: {} as Record<string, number> };
  const extras = { count: 0, total_by_currency: {} as Record<string, number> };
  const excluded = { refunded_supports: 0, revoked_extras: 0 };
  const within = (date: unknown): boolean => {
    const time = timestamp(date);
    if (time === null) throw new ApiError("Cannot summarize a record with a missing or invalid date.");
    return time >= from && time <= to;
  };
  const add = (target: typeof supports, amount: number | null, currency: string | null) => {
    if (amount === null || !currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new ApiError("Cannot summarize a record with a missing or invalid amount or currency.");
    }
    const total = (target.total_by_currency[currency] ?? 0) + amount;
    if (!Number.isFinite(total)) throw new ApiError("Currency total exceeds the supported numeric range.");
    target.count++;
    target.total_by_currency[currency] = Number(total.toFixed(8));
  };
  for (const row of supporters) {
    const item = supporter(row);
    if (!within(item.created_at)) continue;
    if (item.refunded) excluded.refunded_supports++;
    else add(supports, item.amount, item.currency);
  }
  for (const row of purchases) {
    const item = purchase(row);
    if (!within(item.purchased_at)) continue;
    if (item.revoked) excluded.revoked_extras++;
    else add(extras, item.amount, item.currency);
  }
  return { window_days: days, from: new Date(from).toISOString(), to: now.toISOString(), supports, extras, excluded, pages_fetched: pagesFetched };
}
