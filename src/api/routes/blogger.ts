import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../validate.js";
import {
  getUserChannels,
  createNewChannel,
  editChannel,
  removeChannel,
  getChannelPosts,
  createNewPost,
  getPost,
  removePost,
  getPostSources,
  addTextSource,
  generatePostText,
} from "../../services/bloggerService.js";
import { logApiAction } from "../../logging/actionLogger.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const createChannelBody = z.object({
  channelTitle: z.string().min(1),
  channelUsername: z.string().optional(),
  nicheDescription: z.string().optional(),
});
const updateChannelBody = z.object({
  channelTitle: z.string().optional(),
  channelUsername: z.string().nullable().optional(),
  nicheDescription: z.string().nullable().optional(),
});
const createPostBody = z.object({
  channelId: z.number(),
  topic: z.string().min(1),
});
const addSourceBody = z.object({
  content: z.string().min(1),
  title: z.string().optional(),
});

app.get("/channels", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;

  try {
    const channels = await getUserChannels(telegramId);
    return c.json({ ok: true, data: channels });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get channels";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/channels", zValidator("json", createChannelBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{
    channelTitle: string;
    channelUsername?: string;
    nicheDescription?: string;
  }>();

  if (!body.channelTitle?.trim()) {
    return c.json({ ok: false, error: "channelTitle is required" }, 400);
  }

  try {
    const channel = await createNewChannel(telegramId, {
      channelTitle: body.channelTitle.trim(),
      channelUsername: body.channelUsername,
      nicheDescription: body.nicheDescription,
    });
    logApiAction(telegramId, "blogger_channel_create", { channelTitle: body.channelTitle.trim() });
    return c.json({ ok: true, data: channel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.put("/channels/:id", zValidator("param", idParam), zValidator("json", updateChannelBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const channelId = parseInt(c.req.param("id"), 10);

  if (isNaN(channelId)) {
    return c.json({ ok: false, error: "Invalid channel ID" }, 400);
  }

  const body = await c.req.json<{
    channelTitle?: string;
    channelUsername?: string | null;
    nicheDescription?: string | null;
  }>();

  if (
    body.channelTitle === undefined &&
    body.channelUsername === undefined &&
    body.nicheDescription === undefined
  ) {
    return c.json({ ok: false, error: "No fields to update" }, 400);
  }

  if (body.channelTitle !== undefined && !body.channelTitle.trim()) {
    return c.json({ ok: false, error: "channelTitle cannot be empty" }, 400);
  }

  try {
    const channel = await editChannel(telegramId, channelId, {
      channelTitle: body.channelTitle?.trim(),
      channelUsername: body.channelUsername,
      nicheDescription: body.nicheDescription,
    });

    if (!channel) {
      return c.json({ ok: false, error: "Channel not found" }, 404);
    }

    return c.json({ ok: true, data: channel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/channels/:id/posts", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const channelId = parseInt(c.req.param("id"), 10);

  if (isNaN(channelId)) {
    return c.json({ ok: false, error: "Invalid channel ID" }, 400);
  }

  try {
    const posts = await getChannelPosts(telegramId, channelId);
    return c.json({ ok: true, data: posts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get posts";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/posts", zValidator("json", createPostBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const body = await c.req.json<{ channelId: number; topic: string }>();

  if (!body.channelId || !body.topic?.trim()) {
    return c.json({ ok: false, error: "channelId and topic are required" }, 400);
  }

  try {
    const post = await createNewPost(telegramId, body.channelId, body.topic.trim());
    return c.json({ ok: true, data: post });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create post";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/posts/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const postId = parseInt(c.req.param("id"), 10);

  if (isNaN(postId)) {
    return c.json({ ok: false, error: "Invalid post ID" }, 400);
  }

  try {
    const post = await getPost(telegramId, postId);
    if (!post) {
      return c.json({ ok: false, error: "Post not found" }, 404);
    }

    const sources = await getPostSources(telegramId, postId);
    return c.json({ ok: true, data: { ...post, sources } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get post";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/posts/:id/generate", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const postId = parseInt(c.req.param("id"), 10);

  if (isNaN(postId)) {
    return c.json({ ok: false, error: "Invalid post ID" }, 400);
  }

  try {
    const post = await generatePostText(telegramId, postId);
    logApiAction(telegramId, "blogger_post_generate", { postId });
    return c.json({ ok: true, data: post });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate post";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/channels/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const channelId = parseInt(c.req.param("id"), 10);

  if (isNaN(channelId)) {
    return c.json({ ok: false, error: "Invalid channel ID" }, 400);
  }

  try {
    const deleted = await removeChannel(telegramId, channelId);
    logApiAction(telegramId, "blogger_channel_delete", { channelId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.delete("/posts/:id", zValidator("param", idParam), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const postId = parseInt(c.req.param("id"), 10);

  if (isNaN(postId)) {
    return c.json({ ok: false, error: "Invalid post ID" }, 400);
  }

  try {
    const deleted = await removePost(telegramId, postId);
    logApiAction(telegramId, "blogger_post_delete", { postId });
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete post";
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/posts/:id/sources", zValidator("param", idParam), zValidator("json", addSourceBody), async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const postId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ content: string; title?: string }>();

  if (isNaN(postId)) {
    return c.json({ ok: false, error: "Invalid post ID" }, 400);
  }
  if (!body.content?.trim()) {
    return c.json({ ok: false, error: "content is required" }, 400);
  }

  try {
    const source = await addTextSource(telegramId, postId, body.content.trim(), body.title);
    return c.json({ ok: true, data: source });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add source";
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default app;
