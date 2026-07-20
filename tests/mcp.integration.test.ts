import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * MCP server smoke test: in-memory Client ↔ Server (no HTTP), exercising the
 * registry-driven tools end-to-end against a real DB. Verifies access-filtered
 * tool listing, a real tool call (create+list), and access denial.
 * Run: DATABASE_URL=postgres://... npx tsx --test tests/mcp.integration.test.ts
 */

const TG = 999000101;
let userId: number;
let tribeId: number;

/* eslint-disable @typescript-eslint/no-explicit-any */
let ClientCtor: any;
let InMemoryTransport: any;
let buildMcpServer: any;

const tribeMenu = () => ({ role: "user" as const, status: "approved", hasTribe: true, tribeId, tribeName: null });
const noTribeMenu = { role: "user" as const, status: "approved", hasTribe: false, tribeId: null, tribeName: null };

before(async () => {
  (await import("dotenv")).config();
  const { setupTestDb, seedFixtures } = await import("./helpers/testDb.js");
  await setupTestDb();
  await seedFixtures();
  const { ensureUser } = await import("../src/expenses/repository.js");
  const user = await ensureUser(TG, "mcptest", "MCP", "Tester", false);
  userId = user.id;
  tribeId = user.tribeId;

  ClientCtor = (await import("@modelcontextprotocol/sdk/client/index.js")).Client;
  InMemoryTransport = (await import("@modelcontextprotocol/sdk/inMemory.js")).InMemoryTransport;
  buildMcpServer = (await import("../src/mcp/server.js")).buildMcpServer;
});

after(async () => {
  const { db } = await import("../src/db/drizzle.js");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM reminders WHERE user_id = ${userId}`);
  const { cleanupTestUser, closeTestDb } = await import("./helpers/testDb.js");
  await cleanupTestUser(TG);
  await closeTestDb();
});

async function connect(menu: unknown): Promise<any> {
  const server = buildMcpServer({ telegramId: TG, menu });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new ClientCtor({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe("mcp: tool listing", () => {
  it("lists access-filtered tools with input schemas", async () => {
    const client = await connect(tribeMenu());
    const { tools } = await client.listTools();
    const names = tools.map((t: any) => t.name);
    assert.ok(names.includes("reminders.create"));
    assert.ok(names.includes("tasks.item.add"));
    const create = tools.find((t: any) => t.name === "reminders.create");
    assert.equal(create.inputSchema.type, "object");
    assert.ok(create.inputSchema.properties.text);
    await client.close();
  });

  it("hides tribe-mode tools when the user has no tribe", async () => {
    const client = await connect(noTribeMenu);
    const names = (await client.listTools()).tools.map((t: any) => t.name);
    assert.ok(names.includes("reminders.create"));
    assert.ok(!names.includes("tasks.item.add"));
    await client.close();
  });
});

describe("mcp: tool calls", () => {
  it("creates then lists a reminder via tools (JSON payload with id)", async () => {
    const client = await connect(tribeMenu());
    const created = await client.callTool({
      name: "reminders.create",
      arguments: { text: "MCP напоминание", schedule: { times: ["09:00"], weekdays: [1] } },
    });
    const createdData = JSON.parse(created.content[0].text);
    assert.ok(createdData.id > 0);

    const listed = await client.callTool({ name: "reminders.list", arguments: {} });
    const arr = JSON.parse(listed.content[0].text);
    assert.ok(arr.some((r: { id: number }) => r.id === createdData.id));
    await client.close();
  });

  it("returns an error for an inaccessible tool", async () => {
    const client = await connect(noTribeMenu);
    const res = await client.callTool({
      name: "tasks.item.add",
      arguments: { workId: 1, text: "x", deadline: "2026-08-01T10:00:00+03:00" },
    });
    assert.equal(res.isError, true);
    await client.close();
  });
});
