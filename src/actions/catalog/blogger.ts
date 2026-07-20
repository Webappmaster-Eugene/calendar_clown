import { z } from "zod";
import { defineAction, type Action } from "../types.js";
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

const channelIdArg = z.object({ id: z.number().int().positive() });
const postIdArg = z.object({ id: z.number().int().positive() });

export const bloggerActions: Action[] = [
  defineAction({
    name: "blogger.channels.list", mode: "blogger", humanTitle: "Список каналов",
    description: "Показать каналы блогера (с количеством постов и id).",
    argsSchema: z.object({}), mutates: false,
    handler: async (ctx) => ({ data: await getUserChannels(ctx.telegramId) }),
  }),
  defineAction({
    name: "blogger.channel.create", mode: "blogger", humanTitle: "Создать канал",
    description: "Создать канал блогера (название, опц. username и описание ниши).",
    argsSchema: z.object({
      channelTitle: z.string().min(1),
      channelUsername: z.string().optional(),
      nicheDescription: z.string().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({
      data: await createNewChannel(ctx.telegramId, {
        channelTitle: a.channelTitle.trim(),
        channelUsername: a.channelUsername,
        nicheDescription: a.nicheDescription,
      }),
    }),
  }),
  defineAction({
    name: "blogger.channel.update", mode: "blogger", humanTitle: "Изменить канал",
    description: "Изменить название/username/нишу канала по id (переданные поля).",
    argsSchema: z.object({
      id: z.number().int().positive(),
      channelTitle: z.string().optional(),
      channelUsername: z.string().nullable().optional(),
      nicheDescription: z.string().nullable().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => {
      const { id, ...updates } = a;
      const c = await editChannel(ctx.telegramId, id, updates);
      if (!c) throw new Error("Канал не найден.");
      return { data: c };
    },
  }),
  defineAction({
    name: "blogger.channel.delete", mode: "blogger", humanTitle: "Удалить канал",
    description: "Удалить канал блогера и все его посты по id.",
    argsSchema: channelIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removeChannel(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "blogger.posts.list", mode: "blogger", humanTitle: "Посты канала",
    description: "Показать посты канала по channelId (пагинация limit/offset).",
    argsSchema: z.object({
      channelId: z.number().int().positive(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    mutates: false,
    handler: async (ctx, a) => ({ data: await getChannelPosts(ctx.telegramId, a.channelId, a.limit ?? 5, a.offset ?? 0) }),
  }),
  defineAction({
    name: "blogger.post.create", mode: "blogger", humanTitle: "Создать пост",
    description: "Создать черновик поста в канале (channelId, тема).",
    argsSchema: z.object({ channelId: z.number().int().positive(), topic: z.string().min(1) }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await createNewPost(ctx.telegramId, a.channelId, a.topic.trim()) }),
  }),
  defineAction({
    name: "blogger.post.get", mode: "blogger", humanTitle: "Пост с источниками",
    description: "Показать пост и его источники по id.",
    argsSchema: postIdArg, mutates: false,
    handler: async (ctx, a) => {
      const post = await getPost(ctx.telegramId, a.id);
      if (!post) throw new Error("Пост не найден.");
      const sources = await getPostSources(ctx.telegramId, a.id);
      return { data: { ...post, sources } };
    },
  }),
  defineAction({
    name: "blogger.post.delete", mode: "blogger", humanTitle: "Удалить пост",
    description: "Удалить пост по id.",
    argsSchema: postIdArg, mutates: true,
    handler: async (ctx, a) => ({ data: { deleted: await removePost(ctx.telegramId, a.id), id: a.id } }),
  }),
  defineAction({
    name: "blogger.post.addSource", mode: "blogger", humanTitle: "Добавить источник",
    description: "Добавить текстовый источник к посту (postId, content, опц. title).",
    argsSchema: z.object({
      postId: z.number().int().positive(),
      content: z.string().min(1),
      title: z.string().optional(),
    }),
    mutates: true,
    handler: async (ctx, a) => ({ data: await addTextSource(ctx.telegramId, a.postId, a.content.trim(), a.title) }),
  }),
  defineAction({
    name: "blogger.post.generate", mode: "blogger", humanTitle: "Сгенерировать пост",
    description: "Сгенерировать текст поста по источникам через LLM (по postId).",
    argsSchema: postIdArg, mutates: true, heavy: true,
    handler: async (ctx, a) => ({ data: await generatePostText(ctx.telegramId, a.id) }),
  }),
];
