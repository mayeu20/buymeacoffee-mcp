import { describe, expect, it } from "vitest";
import { protectJson, redactEmail } from "../src/redact.js";

describe("privacy", () => {
  it("keeps only the first character and domain", () => {
    expect(redactEmail("jamie@example.com")).toBe("j***@example.com");
    expect(redactEmail("j@example.com")).toBe("j***@example.com");
    expect(redactEmail("j***@example.com")).toBe("j***@example.com");
    expect(redactEmail("invalid")).toBe("[redacted]");
  });
  it("protects nested emails, free text, keys, and malformed email fields without mutating", () => {
    const input = { payer_email: "broken", nested: [{ support_email: "alex@example.com" }], note: "Ask jamie@example.com", "robin@example.com": "ok" };
    expect(protectJson(input)).toEqual({ payer_email: "[redacted]", nested: [{ support_email: "a***@example.com" }], note: "Ask j***@example.com", "r***@example.com": "ok" });
    expect(input.nested[0]?.support_email).toBe("alex@example.com");
  });
  it("returns full emails only on opt-in but always removes the token", () => {
    expect(protectJson({ email: "jamie@example.com", note: "secret-test-token" }, true, "secret-test-token"))
      .toEqual({ email: "jamie@example.com", note: "[redacted]" });
    expect(protectJson([null, true, 12])).toEqual([null, true, 12]);
  });
});
