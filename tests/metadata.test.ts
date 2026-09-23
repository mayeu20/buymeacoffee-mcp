import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import packageJson from "../package.json";
import serverJson from "../server.json";

// Every tool input field must carry a description: it is the only documentation a client
// ever shows, and an undescribed field is guessed at. Listing the tools proves nothing on
// its own, so the number of fields inspected is asserted too, and the predicate is run
// against a fixture that IS missing a description to prove it can still report one.
interface ToolSchema { name: string; inputSchema: { properties?: Record<string, unknown> } }

function undescribed(tools: readonly ToolSchema[]): { fields: string[]; inspected: number } {
  const fields: string[] = [];
  let inspected = 0;
  for (const tool of tools) {
    for (const [field, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      inspected++;
      const description = (schema as { description?: unknown }).description;
      if (typeof description !== "string" || description.trim().length < 20) {
        fields.push(`${tool.name}.${field}`);
      }
    }
  }
  return { fields, inspected };
}

async function connect() {
  const server = createServer();
  const client = new Client({ name: "metadata-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("published metadata", () => {
  it("describes every input field of every tool", async () => {
    const { client, close } = await connect();
    try {
      const tools = (await client.listTools()).tools as unknown as ToolSchema[];
      const { fields, inspected } = undescribed(tools);
      expect(fields).toEqual([]);
      // Guard the guard: an empty tool list, or schemas that stopped exposing properties,
      // would also report no failures. Four tools, twelve arguments between them.
      expect(tools).toHaveLength(4);
      expect(inspected).toBe(12);
    } finally { await close(); }
  });

  it("reports a field with no description, and one whose description is a placeholder", () => {
    const { fields, inspected } = undescribed([
      { name: "good", inputSchema: { properties: { a: { description: "A field described at ordinary length." } } } },
      { name: "bare", inputSchema: { properties: { b: {} } } },
      { name: "stub", inputSchema: { properties: { c: { description: "days" } } } },
    ]);
    expect(fields).toEqual(["bare.b", "stub.c"]);
    expect(inspected).toBe(3);
  });

  it("warns in every description that turns emails on", async () => {
    // The one field that leaks another person's data if a caller sets it on a guess.
    const { client, close } = await connect();
    try {
      const tools = (await client.listTools()).tools as unknown as ToolSchema[];
      const withEmails = tools.filter(tool => tool.inputSchema.properties?.include_emails);
      expect(withEmails.map(tool => tool.name).sort())
        .toEqual(["list_extra_purchases", "list_subscriptions", "list_supporters"]);
      for (const tool of withEmails) {
        const field = tool.inputSchema.properties!.include_emails as { description: string };
        expect(field.description).toContain("redacted");
        expect(field.description).toContain("Leave false");
      }
    } finally { await close(); }
  });

  it("advertises one version, in all three places a reader can find it", async () => {
    const { client, close } = await connect();
    try {
      // Read from the CLIENT, because the handshake value is the one a user actually sees.
      const advertised = client.getServerVersion();
      expect(advertised?.name).toBe("buymeacoffee-mcp");
      expect(advertised?.version).toBe(packageJson.version);
      expect(serverJson.version).toBe(packageJson.version);
      expect(serverJson.packages[0]!.version).toBe(packageJson.version);
      expect(serverJson.name).toBe(packageJson.mcpName);
      expect(serverJson.packages[0]!.identifier).toBe(packageJson.name);
      // The registry entry documents the one thing a user has to supply themselves.
      const variables = serverJson.packages[0]!.environmentVariables;
      expect(variables.map(variable => variable.name)).toEqual(["BMAC_TOKEN"]);
      expect(variables[0]!.description.length).toBeGreaterThan(20);
      expect(variables[0]!.isSecret).toBe(true);
    } finally { await close(); }
  });
});
