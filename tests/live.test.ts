import { expect, it } from "vitest";
import { ApiClient } from "../src/client.js";

// Short circuit so ordinary tests never read a real token.
const enabled = process.env.BMAC_LIVE === "1" && Boolean(process.env.BMAC_TOKEN);
it.skipIf(!enabled)("live: reads one page from each official endpoint", async () => {
  const api = new ApiClient();
  for (const endpoint of ["supporters", "extras", "subscriptions"] as const) {
    const result = await api.walk(endpoint, 1);
    expect(result.pages_fetched).toBe(1);
    // Assert shape without printing private account records on failure.
    expect(Array.isArray(result.rows)).toBe(true);
  }
}, 100_000);
