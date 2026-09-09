#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(0), 1500);
  deadline.unref();
  void server.close().then(() => process.exit(0), () => process.exit(1));
};
process.stdin.once("end", shutdown);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
try {
  await server.connect(new StdioServerTransport());
} catch {
  process.exitCode = 1;
}
