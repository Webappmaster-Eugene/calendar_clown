#!/usr/bin/env node
// sovetnik-channel — Claude Code channel that bridges one local session to the
// Sovetnik Telegram hub.
//
// Claude Code starts this file as an MCP subprocess over stdio, so stdout is the
// protocol: every diagnostic goes to stderr, never console.log.
//
// Direction of travel:
//   Telegram → hub → SSE → notifications/claude/channel      → this session
//   this session → reply tool → POST /cc/reply → hub → Telegram
//   Claude Code permission dialog → POST /cc/permission → inline buttons
//   button press → SSE verdict → notifications/claude/channel/permission
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join, relative } from "node:path";
import { z } from "zod";

const HUB_URL = (process.env.CC_HUB_URL ?? "").replace(/\/+$/, "");
const MACHINE_TOKEN = process.env.CC_MACHINE_TOKEN ?? "";

function log(message: string): void {
  process.stderr.write(`sovetnik-channel: ${message}\n`);
}

if (!HUB_URL || !MACHINE_TOKEN) {
  log("CC_HUB_URL and CC_MACHINE_TOKEN must be set — exiting");
  process.exit(1);
}

// ─── Local context ───────────────────────────────────────────────────────────

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const cwd = process.cwd();
const repoRoot = git(["rev-parse", "--show-toplevel"]);
const machine = slug(process.env.CC_MACHINE ?? hostname().split(".")[0] ?? "unknown") || "unknown";
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

// The hub keys topics by cwd, so a subdirectory of a repo gets its own topic.
// Naming it after the repo alone would produce two topics with identical names.
const project = !repoRoot
  ? basename(cwd)
  : cwd === repoRoot
    ? basename(repoRoot)
    : `${basename(repoRoot)}/${relative(repoRoot, cwd)}`;

// Names let several sessions share a project and still get their own topic.
// Trimmed to something a topic title can hold; empty means the project's
// default topic, which keeps pre-existing topics addressed the same way.
const session = (process.env.CC_SESSION ?? "").trim().slice(0, 60);

// ─── MCP server ──────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: "sovetnik", version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions:
      'Messages from the user arrive as <channel source="sovetnik">. They are the user talking to you from Telegram, ' +
      "often dictated by voice, so expect transcription noise in names and paths. " +
      "Always answer with the sovetnik reply tool: the user is not at this terminal and sees nothing you print here. " +
      "Keep replies short enough to read on a phone.",
  },
);

// ─── Session state ───────────────────────────────────────────────────────────

let sessionId: string | null = null;
let sessionToken: string | null = null;
let closing = false;

function hubUrl(path: string): string {
  const suffix = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  return `${HUB_URL}${path}${suffix}`;
}

async function register(): Promise<boolean> {
  try {
    const res = await fetch(`${HUB_URL}/cc/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MACHINE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        machine,
        hostname: hostname(),
        cwd,
        project,
        session,
        branch,
        ccVersion: process.env.CLAUDE_CODE_VERSION ?? null,
      }),
    });
    if (!res.ok) {
      log(`register failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      return false;
    }
    const body = (await res.json()) as { sessionId?: string; sessionToken?: string };
    if (!body.sessionId || !body.sessionToken) {
      log("register returned an incomplete payload");
      return false;
    }
    sessionId = body.sessionId;
    sessionToken = body.sessionToken;
    log(`registered as ${machine} · ${project}${session ? ` · ${session}` : ""}${branch ? ` (${branch})` : ""}`);
    return true;
  } catch (err) {
    log(`register error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function post(path: string, payload: unknown): Promise<void> {
  if (!sessionToken) return;
  try {
    const res = await fetch(hubUrl(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) log(`POST ${path} failed: HTTP ${res.status}`);
  } catch (err) {
    log(`POST ${path} error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Inbound stream ──────────────────────────────────────────────────────────

const HubEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), content: z.string(), meta: z.record(z.string()).optional() }),
  z.object({
    type: z.literal("verdict"),
    requestId: z.string(),
    behavior: z.union([z.literal("allow"), z.literal("deny")]),
  }),
  z.object({
    type: z.literal("file"),
    key: z.string(),
    name: z.string(),
    mime: z.string(),
    size: z.number(),
    caption: z.string(),
  }),
]);

const INBOX = join(homedir(), ".sovetnik-channel", "inbox");

/** Telegram file names are attacker-adjacent input; keep them to a bare basename. */
function safeName(name: string): string {
  const bare = basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
  return bare && bare !== "." && bare !== ".." ? bare : "attachment";
}

/** Pulls the bytes back through the hub and drops them where Claude can read them. */
async function downloadAttachment(key: string, name: string): Promise<string | null> {
  try {
    const res = await fetch(`${hubUrl("/cc/file")}&key=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${sessionToken ?? ""}` },
    });
    if (!res.ok) {
      log(`attachment download failed: HTTP ${res.status}`);
      return null;
    }
    mkdirSync(INBOX, { recursive: true });
    // Prefixed with the key so two files with the same name never collide.
    const path = join(INBOX, `${key.slice(0, 8)}_${safeName(name)}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    return path;
  } catch (err) {
    log(`attachment error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function dispatch(raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const event = HubEventSchema.safeParse(parsed);
  if (!event.success) return;

  if (event.data.type === "message") {
    await mcp.notification({
      method: "notifications/claude/channel",
      params: { content: event.data.content, meta: event.data.meta ?? {} },
    });
    return;
  }

  if (event.data.type === "file") {
    const { key, name, mime, size, caption } = event.data;
    const path = await downloadAttachment(key, name);
    const content = path
      ? `Пользователь прислал файл: ${path} (${mime}, ${Math.round(size / 1024)} КБ). ` +
        `Прочитай его, если это нужно для ответа.` +
        (caption ? `\n\nПодпись: ${caption}` : "")
      : `Пользователь прислал файл "${name}", но скачать его не удалось.`;
    await mcp.notification({
      method: "notifications/claude/channel",
      params: { content, meta: path ? { file_path: path, file_name: name } : {} },
    });
    return;
  }

  await mcp.notification({
    method: "notifications/claude/channel/permission",
    params: { request_id: event.data.requestId, behavior: event.data.behavior },
  });
}

/** Reads the SSE body until it ends; returns so the caller can back off and retry. */
async function consumeStream(): Promise<void> {
  const res = await fetch(hubUrl("/cc/stream"), {
    headers: { Authorization: `Bearer ${sessionToken ?? ""}`, Accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) {
    // 401 means the hub forgot this session — most likely it restarted.
    if (res.status === 401) {
      sessionId = null;
      sessionToken = null;
    }
    throw new Error(`stream HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; anything after the last one is a
    // partial frame that must wait for the next chunk.
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data) await dispatch(data);
      split = buffer.indexOf("\n\n");
    }
  }
}

async function streamForever(): Promise<void> {
  let backoffMs = 1_000;
  while (!closing) {
    if (!sessionId || !sessionToken) {
      if (!(await register())) {
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
        continue;
      }
    }
    try {
      await consumeStream();
      backoffMs = 1_000; // a clean end is a normal reconnect, not a failure
    } catch (err) {
      if (closing) return;
      log(`stream dropped: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Outbound: reply tool ────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a message to the user in Telegram. This is the only way the user sees your answer.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text. Plain text, no markdown tables." },
        },
        required: ["text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const args = req.params.arguments as { text?: unknown } | undefined;
  const text = typeof args?.text === "string" ? args.text : "";
  if (!text.trim()) {
    return { isError: true, content: [{ type: "text", text: "text is required" }] };
  }
  await post("/cc/reply", { text });
  return { content: [{ type: "text", text: "sent" }] };
});

// ─── Outbound: permission relay ──────────────────────────────────────────────

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  await post("/cc/permission", {
    requestId: params.request_id,
    toolName: params.tool_name,
    description: params.description,
    inputPreview: params.input_preview,
  });
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  if (sessionToken) await post("/cc/bye", {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
// Claude Code closes stdin when it tears the subprocess down.
process.stdin.on("close", () => void shutdown());

await mcp.connect(new StdioServerTransport());
void streamForever();
