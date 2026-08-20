// Wire types for the Claude Code bridge. The machine side speaks these over
// HTTPS (inbound: SSE, outbound: POST) so laptops never need an open port.

/** Sent by the channel MCP server when a Claude Code session starts. */
export interface CcRegisterRequest {
  /** Stable per-machine slug, e.g. "mbp". Used as the topic name prefix. */
  machine: string;
  hostname: string;
  cwd: string;
  /** Basename of cwd, or the git repo name when there is one. */
  project: string;
  branch?: string | null;
  ccVersion?: string | null;
}

export interface CcRegisterResponse {
  sessionId: string;
  /** Scopes every later call to this one session; the machine token alone is not enough. */
  sessionToken: string;
  threadId: number;
}

/** Machine → hub: Claude produced a message for the user. */
export interface CcReplyRequest {
  text: string;
}

/** Machine → hub: Claude Code wants approval for a tool call. */
export interface CcPermissionRequest {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

/** Hub → machine, over SSE. */
export type CcEvent =
  | { type: "message"; content: string; meta: Record<string, string> }
  | { type: "verdict"; requestId: string; behavior: "allow" | "deny" };

export interface CcSessionInfo {
  id: string;
  machine: string;
  hostname: string;
  cwd: string;
  project: string;
  branch: string | null;
  threadId: number;
  connected: boolean;
  startedAt: string;
  lastSeenAt: string;
}
