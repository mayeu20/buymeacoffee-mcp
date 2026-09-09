import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";

export async function fixture(name: string) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

export async function fixtureServer() {
  const requests: { url: string; authorization?: string; userAgent?: string; time: number }[] = [];
  const server = createServer(async (req, res) => {
    requests.push({ url: req.url!, authorization: req.headers.authorization, userAgent: req.headers["user-agent"], time: performance.now() });
    const url = new URL(req.url!, "http://127.0.0.1");
    const endpoint = url.pathname.split("/").pop();
    const file = endpoint === "subscriptions" ? "subscriptions-empty"
      : endpoint === "supporters" ? `supporters-${url.searchParams.get("page") ?? 1}`
      : endpoint === "extras" ? "extras-1" : "missing";
    try {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(await fixture(file)));
    } catch {
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/`;
  return { apiBase, requests, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }) };
}
