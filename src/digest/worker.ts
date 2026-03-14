/**
 * Digest worker: orchestrates the full digest pipeline for a single rubric.
 * Parse channels → rank posts → summarize → save to DB → send to user.
 */

import type { Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { readMultipleChannels } from "./telegramClient.js";
import { selectTopPosts, DEFAULT_DIGEST_SIZE } from "./parser.js";
import { summarizePosts } from "./summarizer.js";
import { discoverChannels } from "./discovery.js";
import {
  getActiveRubricsByUser,
  getChannelsByRubric,
  createRun,
  completeRun,
  failRun,
  insertDigestPosts,
} from "./repository.js";
import type { DigestRubric, CreateDigestPostParams, RawChannelPost } from "./types.js";
import { TIMEZONE_MSK } from "../constants.js";
import { escapeMarkdown } from "../utils/markdown.js";
import { getUserByTelegramId } from "../expenses/repository.js";

const log = createLogger("digest");

/** Telegram message max length. */
const TG_MAX_LENGTH = 4096;

/**
 * Run digest for a single user (all their active rubrics).
 * Returns number of rubrics processed.
 */
export async function runDigestForUser(
  telegramId: number,
  bot: Telegraf
): Promise<number> {
  const dbUser = await getUserByTelegramId(telegramId);
  if (!dbUser) {
    log.warn(`Digest: user ${telegramId} not found in DB`);
    return 0;
  }

  const rubrics = await getActiveRubricsByUser(dbUser.id);
  if (rubrics.length === 0) {
    log.info(`Digest: user ${telegramId} has no active rubrics`);
    return 0;
  }

  let processed = 0;
  for (let i = 0; i < rubrics.length; i++) {
    try {
      await runDigestForRubric(rubrics[i], dbUser.id, telegramId, bot);
      processed++;
    } catch (err) {
      log.error(`Digest failed for rubric "${rubrics[i].name}":`, err);
    }

    // Pause between rubrics
    if (i < rubrics.length - 1) {
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  return processed;
}

/**
 * Run digest for a single rubric: parse → rank → summarize → save → send.
 */
async function runDigestForRubric(
  rubric: DigestRubric,
  dbUserId: number,
  telegramId: number,
  bot: Telegraf
): Promise<void> {
  const channels = await getChannelsByRubric(rubric.id);
  if (channels.length === 0) {
    log.info(`Rubric "${rubric.name}": no channels, skipping`);
    return;
  }

  const run = await createRun(dbUserId, rubric.id);
  log.info(`Digest run #${run.id} started: rubric="${rubric.name}", channels=${channels.length}`);

  try {
    // 1. Parse channels
    const { posts, channelsParsed, errors } = await readMultipleChannels(
      channels.map((c) => ({ username: c.channelUsername })),
      24
    );

    if (posts.length === 0) {
      await completeRun(run.id, channelsParsed, 0, 0);
      await sendMessage(
        bot,
        telegramId,
        `${rubric.emoji ?? "📰"} *${escapeMarkdown(rubric.name)}*\n\nЗа последние 24 часа новых публикаций не найдено.`
      );
      return;
    }

    // 2. Rank and select top posts
    const topPosts = selectTopPosts(posts, DEFAULT_DIGEST_SIZE);

    // 3. Summarize posts
    const summaries = await summarizePosts(topPosts.map((p) => p.text));

    // 4. Save to DB
    const dbPosts: CreateDigestPostParams[] = topPosts.map((post, i) => ({
      runId: run.id,
      rubricId: rubric.id,
      userId: dbUserId,
      channelUsername: post.channelUsername,
      channelTitle: post.channelTitle,
      telegramMessageId: post.messageId,
      messageUrl: `https://t.me/${post.channelUsername}/${post.messageId}`,
      originalText: post.text,
      summary: summaries[i] ?? null,
      postDate: post.date,
      views: post.views,
      forwards: post.forwards,
      reactionsCount: post.reactionsCount,
      commentsCount: post.commentsCount,
      engagementScore: post.engagementScore,
      isFromTrackedChannel: true,
    }));

    await insertDigestPosts(dbPosts);
    await completeRun(run.id, channelsParsed, posts.length, topPosts.length);

    // 5. Format and send digest
    const message = formatDigestMessage(rubric, topPosts, summaries);
    await sendMessage(bot, telegramId, message);

    // 6. Discovery: suggest new channels (if any mentioned frequently)
    const trackedSet = new Set(channels.map((c) => c.channelUsername));
    const discovered = discoverChannels(posts, trackedSet);
    if (discovered.length > 0) {
      const top3 = discovered.slice(0, 3);
      const suggestions = top3
        .map((d) => `@${d.username} (${d.mentionCount} упоминаний)`)
        .join("\n");
      await sendMessage(
        bot,
        telegramId,
        `💡 *Рекомендации каналов для "${escapeMarkdown(rubric.name)}":*\n${suggestions}\n\nДобавить: /digest add <рубрика> @канал`
      );
    }

    log.info(
      `Digest run #${run.id} completed: parsed=${channelsParsed}, found=${posts.length}, selected=${topPosts.length}, errors=${errors}`
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await failRun(run.id, errorMsg);
    throw err;
  }
}

/** Format the digest message for Telegram. */
function formatDigestMessage(
  rubric: DigestRubric,
  posts: Array<RawChannelPost & { engagementScore: number }>,
  summaries: Array<string | null>
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIMEZONE_MSK,
  });

  let header = `${rubric.emoji ?? "📰"} *Дайджест: ${escapeMarkdown(rubric.name)}*\n`;
  header += `${dateStr} | ${posts.length} публикаций\n`;
  header += "━━━━━━━━━━━━━━━━━━━━━━\n\n";

  const items: string[] = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const summary = summaries[i];
    const viewsStr = formatNumber(post.views);
    const channelStr = `@${post.channelUsername}`;

    let statsStr = `${viewsStr} просм.`;
    if (post.reactionsCount > 0) statsStr += ` • ${post.reactionsCount} реакций`;
    if (post.commentsCount > 0) statsStr += ` • ${post.commentsCount} комм.`;

    const link = `https://t.me/${post.channelUsername}/${post.messageId}`;
    const summaryText = summary
      ? `${escapeMarkdown(summary)}\n`
      : "";

    items.push(
      `${i + 1}. ${channelStr} • ${statsStr}\n` +
      `${summaryText}` +
      `🔗 ${link}`
    );
  }

  const body = items.join("\n\n");
  const full = header + body;

  // Truncate if too long for Telegram
  if (full.length > TG_MAX_LENGTH) {
    return full.slice(0, TG_MAX_LENGTH - 20) + "\n\n...";
  }
  return full;
}

/** Format large numbers: 12500 → "12.5K". */
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Send a message to a user, handling Markdown errors gracefully. */
async function sendMessage(bot: Telegraf, chatId: number, text: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      // Disable link previews for cleaner digest
      link_preview_options: { is_disabled: true },
    } as never);
  } catch {
    // Fallback: send without markdown
    try {
      await bot.telegram.sendMessage(
        chatId,
        text.replace(/([*_`\[\]\\])/g, "")
      );
    } catch (err) {
      log.error(`Failed to send digest to ${chatId}:`, err);
    }
  }
}
