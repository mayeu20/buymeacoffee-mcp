export function redactEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 && at < email.length - 1
    ? `${email[0]}***${email.slice(at)}`
    : "[redacted]";
}

// Apply to every string, including notes and nested passthrough records.
export function protectJson(value: unknown, includeEmails = false, token = ""): unknown {
  const protect = (text: string): string => {
    const safe = token ? text.split(token).join("[redacted]") : text;
    return includeEmails ? safe : safe.replace(
      /[^\s<>"(),;:@]+@[^\s<>"(),;:@]+/g,
      (email) => redactEmail(email),
    );
  };
  if (typeof value === "string") return protect(value);
  if (Array.isArray(value)) return value.map((item) => protectJson(item, includeEmails, token));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      protect(key),
      /email/i.test(key) && typeof item === "string" && !includeEmails
        ? redactEmail(protect(item))
        : protectJson(item, includeEmails, token),
    ]));
  }
  return value;
}
