import { Hono } from "hono";
import {
  getUserChannels,
  createNewChannel,
  removeChannel,
  getChannelPosts,
  createNewPost,
  getPost,
  removePost,
  getPostSources,
  addTextSource,
  generatePostText,
} from "../../services/bloggerService.js";
import type { ApiEnv } from "../authMiddleware.js";

const app = new Hono<ApiEnv>();

/** GET /api/blogger/channels — list channels */
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

/** POST /api/blogger/channels — create channel */
app.post("/channels", async (c) => {
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
    return c.json({ ok: true, data: channel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** GET /api/blogger/channels/:id/posts — list posts */
app.get("/channels/:id/posts", async (c) => {
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

/** POST /api/blogger/posts — create post */
app.post("/posts", async (c) => {
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

/** GET /api/blogger/posts/:id — get post with sources */
app.get("/posts/:id", async (c) => {
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

/** POST /api/blogger/posts/:id/generate — generate post content */
app.post("/posts/:id/generate", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const postId = parseInt(c.req.param("id"), 10);

  if (isNaN(postId)) {
    return c.json({ ok: false, error: "Invalid post ID" }, 400);
  }

  try {
    const post = await generatePostText(telegramId, postId);
    return c.json({ ok: true, data: post });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate post";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/blogger/channels/:id — delete channel */
app.delete("/channels/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const channelId = parseInt(c.req.param("id"), 10);

  if (isNaN(channelId)) {
    return c.json({ ok: false, error: "Invalid channel ID" }, 400);
  }

  try {
    const deleted = await removeChannel(telegramId, channelId);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete channel";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** DELETE /api/blogger/posts/:id — delete post */
app.delete("/posts/:id", async (c) => {
  const initData = c.get("initData");
  const telegramId = initData.user.id;
  const postId = parseInt(c.req.param("id"), 10);

  if (isNaN(postId)) {
    return c.json({ ok: false, error: "Invalid post ID" }, 400);
  }

  try {
    const deleted = await removePost(telegramId, postId);
    return c.json({ ok: true, data: { deleted } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete post";
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** POST /api/blogger/posts/:id/sources — add text source */
app.post("/posts/:id/sources", async (c) => {
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
