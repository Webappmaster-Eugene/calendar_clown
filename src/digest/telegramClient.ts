import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createLogger } from "../utils/logger.js";
import type { RawChannelPost } from "./types.js";

const log = createLogger("digest");

const SESSION_DIR = "./data/telegram-session";
const SESSION_FILE = join(SESSION_DIR, "session.txt");

/** Minimum pause between channel reads (ms). */
const MIN_DELAY_MS = 3_000;
/** Maximum pause between channel reads (ms). */
const MAX_DELAY_MS = 5_000;

let gramClient: TelegramClient | null = null;

function randomDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Checks TELEGRAM_SESSION env first, then the session file. */
async function loadSession(): Promise<string> {
  const envSession = process.env.TELEGRAM_SESSION?.trim();
  if (envSession) return envSession;
  try {
    const data = await readFile(SESSION_FILE, "utf-8");
    return data.trim();
  } catch {
    return "";
  }
}

async function saveSession(session: string): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(SESSION_FILE, session, "utf-8");
}

function getCredentials(): { apiId: number; apiHash: string } | null {
  const apiId = parseInt(process.env.TELEGRAM_PARSER_API_ID ?? "", 10);
  const apiHash = process.env.TELEGRAM_PARSER_API_HASH?.trim();
  if (!apiId || !apiHash) return null;
  return { apiId, apiHash };
}

export function isDigestConfigured(): boolean {
  return getCredentials() !== null;
}

let sessionChecked: boolean | null = null;

async function hasSession(): Promise<boolean> {
  if (sessionChecked !== null) return sessionChecked;
  const s = await loadSession();
  sessionChecked = s.length > 0;
  return sessionChecked;
}

export async function isDigestReady(): Promise<boolean> {
  if (!isDigestConfigured()) return false;
  return hasSession();
}

export async function connectGramClient(): Promise<TelegramClient> {
  if (gramClient?.connected) return gramClient;
  // A destroyed client reports connected===false but must not be reused.
  gramClient = null;

  const creds = getCredentials();
  if (!creds) throw new Error("TELEGRAM_PARSER_API_ID / TELEGRAM_PARSER_API_HASH not set");

  const sessionStr = await loadSession();
  if (!sessionStr) {
    throw new Error(
      "MTProto session not found. Run `npm run tg-auth` first to authorize."
    );
  }

  const session = new StringSession(sessionStr);
  gramClient = new TelegramClient(session, creds.apiId, creds.apiHash, {
    connectionRetries: 3,
  });

  await gramClient.connect();
  sessionChecked = true;
  log.info("GramJS connected to Telegram.");

  // Telegram may rotate keys on connect; persist the refreshed session.
  const newSession = gramClient.session.save() as unknown as string;
  if (newSession && newSession !== sessionStr) {
    await saveSession(newSession);
    log.debug("Session updated.");
  }

  return gramClient;
}

/** Uses destroy() rather than disconnect() to stop GramJS's internal update loop. */
export async function disconnectGramClient(): Promise<void> {
  if (gramClient) {
    await gramClient.destroy();
    gramClient = null;
    log.info("GramJS disconnected.");
  }
}

export async function readChannelMessages(
  channelUsername: string,
  hoursBack: number = 24,
  limit: number = 100
): Promise<RawChannelPost[]> {
  const client = await connectGramClient();

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const cutoffTimestamp = Math.floor(cutoff.getTime() / 1000);

  log.info(`Reading @${channelUsername} (last ${hoursBack}h, limit ${limit})...`);

  const messages = await client.getMessages(channelUsername, {
    limit,
    offsetDate: Math.floor(Date.now() / 1000),
  });

  const posts: RawChannelPost[] = [];
  let channelTitle: string | null = null;

  for (const msg of messages) {
    if (!msg.message || msg.message.length < 50) continue;
    if (msg.date < cutoffTimestamp) continue;

    if (!channelTitle && msg.chat && "title" in msg.chat) {
      channelTitle = (msg.chat as { title?: string }).title ?? null;
    }

    let reactionsCount = 0;
    if (msg.reactions && "results" in msg.reactions) {
      const results = (msg.reactions as Api.MessageReactions).results;
      if (Array.isArray(results)) {
        for (const r of results) {
          reactionsCount += r.count ?? 0;
        }
      }
    }

    const commentsCount = msg.replies?.replies ?? 0;

    posts.push({
      channelUsername,
      channelTitle,
      messageId: msg.id,
      text: msg.message.slice(0, 4096),
      date: new Date(msg.date * 1000),
      views: msg.views ?? 0,
      forwards: msg.forwards ?? 0,
      reactionsCount,
      commentsCount,
    });
  }

  log.info(`@${channelUsername}: ${posts.length} posts in last ${hoursBack}h`);
  return posts;
}

export async function readMultipleChannels(
  channels: Array<{ username: string }>,
  hoursBack: number = 24
): Promise<{ posts: RawChannelPost[]; channelsParsed: number; errors: number }> {
  const allPosts: RawChannelPost[] = [];
  let channelsParsed = 0;
  let consecutiveErrors = 0;
  let errors = 0;

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (consecutiveErrors >= 3) {
      log.warn(`Circuit breaker: stopping after 3 consecutive errors`);
      break;
    }

    try {
      const posts = await readChannelMessages(ch.username, hoursBack);
      allPosts.push(...posts);
      channelsParsed++;
      consecutiveErrors = 0;
    } catch (err) {
      errors++;
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Error reading @${ch.username}: ${msg}`);

      if (msg.includes("FLOOD_WAIT") || msg.includes("FloodWaitError")) {
        const waitMatch = msg.match(/(\d+)/);
        const waitSec = waitMatch ? parseInt(waitMatch[1], 10) : 60;
        const waitMs = (waitSec + Math.ceil(waitSec * 0.1)) * 1000; // +10% buffer over Telegram's stated wait
        log.warn(`FloodWait: sleeping ${waitSec}s + 10% buffer`);
        await sleep(waitMs);
        // Honoring the wait is not a real failure, so don't trip the circuit breaker.
        consecutiveErrors = 0;
      }
    }

    if (i < channels.length - 1) {
      await sleep(randomDelay());
    }
  }

  return { posts: allPosts, channelsParsed, errors };
}

export async function getUserDialogFolders(
  client?: TelegramClient
): Promise<Array<{ id: number; title: string }>> {
  try {
    const c = client ?? await connectGramClient();
    const result = await c.invoke(new Api.messages.GetDialogFilters());
    const folders: Array<{ id: number; title: string }> = [];
    const filters = "filters" in result && Array.isArray(result.filters) ? result.filters : [];
    for (const filter of filters) {
      if ((filter as { className?: string }).className === "DialogFilterDefault") continue;
      const cn = (filter as { className?: string }).className;
      if (
        (cn === "DialogFilter" || cn === "DialogFilterChatlist") &&
        (filter as Api.DialogFilter).title
      ) {
        const titleObj = (filter as Api.DialogFilter).title;
        const title = typeof titleObj === "string"
          ? titleObj
          : (titleObj as Api.TextWithEntities).text ?? String(titleObj);
        folders.push({ id: (filter as Api.DialogFilter).id, title });
      }
    }
    log.debug(`getUserDialogFolders: found ${folders.length} folders`);
    return folders;
  } catch (err) {
    log.error("Failed to get dialog folders:", err);
    return [];
  }
}

export async function getChannelsFromFolder(
  folderId: number,
  client?: TelegramClient
): Promise<string[]> {
  try {
    const c = client ?? await connectGramClient();
    const result = await c.invoke(new Api.messages.GetDialogFilters());
    const channels: string[] = [];

    const filters = "filters" in result && Array.isArray(result.filters) ? result.filters : [];
    const folder = filters.find((f) => {
      const cn = (f as { className?: string }).className;
      return (cn === "DialogFilter" || cn === "DialogFilterChatlist") &&
        (f as Api.DialogFilter).id === folderId;
    }) as Api.DialogFilter | Api.DialogFilterChatlist | undefined;

    if (folder?.includePeers) {
      let totalPeers = 0;
      let channelPeers = 0;
      let skippedPrivate = 0;
      let skippedErrors = 0;

      for (const peer of folder.includePeers) {
        totalPeers++;
        const peerClassName = (peer as { className?: string }).className;
        if (peerClassName === "InputPeerChannel") {
          channelPeers++;
          try {
            const entity = await c.getEntity(peer);
            const entityClassName = (entity as { className?: string }).className;
            if (entityClassName === "Channel" && (entity as Api.Channel).username) {
              channels.push((entity as Api.Channel).username!);
            } else {
              skippedPrivate++;
              const title = (entity as Api.Channel).title ?? "unknown";
              log.debug(`Skipped private channel "${title}" (no username)`);
            }
          } catch (err) {
            skippedErrors++;
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(`Failed to resolve channel peer in folder ${folderId}: ${msg}`);
          }
        }
      }

      log.info(
        `Folder ${folderId}: ${totalPeers} peers, ${channelPeers} channel peers, ` +
        `${channels.length} public channels, ${skippedPrivate} private, ${skippedErrors} errors`
      );
    }

    return channels;
  } catch (err) {
    log.error(`Failed to get channels from folder ${folderId}:`, err);
    return [];
  }
}

export async function getChannelInfo(
  channelUsername: string
): Promise<{ title: string; subscriberCount: number } | null> {
  try {
    const client = await connectGramClient();
    const entity = await client.getEntity(channelUsername);
    if (entity instanceof Api.Channel) {
      const full = await client.invoke(
        new Api.channels.GetFullChannel({ channel: channelUsername })
      );
      const title = entity.title ?? channelUsername;
      const subscriberCount =
        full.fullChat instanceof Api.ChannelFull
          ? full.fullChat.participantsCount ?? 0
          : 0;
      return { title, subscriberCount };
    }
    return null;
  } catch (err: unknown) {
    // These RPC errors are expected for non-existent or non-channel usernames; log softly.
    const rpcMessage = err != null && typeof err === "object" && "errorMessage" in err
      ? (err as { errorMessage: string }).errorMessage
      : null;
    const expectedErrors = ["USERNAME_INVALID", "USERNAME_NOT_OCCUPIED", "CHANNEL_INVALID"];
    if (rpcMessage && expectedErrors.includes(rpcMessage)) {
      log.info(`@${channelUsername} is not a valid channel (${rpcMessage})`);
    } else {
      log.error(`Failed to get info for @${channelUsername}:`, err);
    }
    return null;
  }
}
