import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { isBootstrapAdmin, getAdminTelegramId } from "../middleware/auth.js";
import {
  addUserByTelegramId,
  removeUserByTelegramId,
  listTribeUsers,
  getUserByTelegramId,
  createPendingUser,
  approveUser,
  rejectUser,
  listPendingUsers,
  isUserInDb,
  setUserTribe,
  removeUserFromTribe,
  listTribes,
  createTribe,
} from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "./expenseMode.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("admin");

type AdminPendingAction =
  | { type: "add_user"; timestamp: number }
  | { type: "new_tribe"; timestamp: number };

/** State for admin pending text input. */
const adminPendingAction = new Map<number, AdminPendingAction>();

/** Clean expired admin actions (older than 5 minutes). */
function cleanExpiredAdminActions(): void {
  const now = Date.now();
  const TTL = 5 * 60 * 1000;
  for (const [key, val] of adminPendingAction) {
    if (now - val.timestamp > TTL) adminPendingAction.delete(key);
  }
}

/** /admin — show admin panel (only for admin). */
export async function handleAdminCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId == null || !isBootstrapAdmin(telegramId)) {
    await ctx.reply("Эта команда доступна только администратору.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  await ctx.reply("🔧 *Панель администратора*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("👥 Список пользователей", "admin:list")],
      [Markup.button.callback("➕ Добавить пользователя", "admin:add")],
      [Markup.button.callback("➖ Удалить пользователя", "admin:remove")],
      [Markup.button.callback("📋 Заявки", "admin:pending")],
      [Markup.button.callback("🏷 Назначить трайб", "admin:tribes")],
      [Markup.button.callback("🚫 Убрать из трайба", "admin:remove_tribe")],
      [Markup.button.callback("➕ Создать трайб", "admin:new_tribe")],
    ]),
  });
}

/** Handle admin inline button callbacks. */
export async function handleAdminCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const telegramId = ctx.from?.id;
  if (telegramId == null || !isBootstrapAdmin(telegramId)) {
    await ctx.answerCbQuery("Доступ запрещён.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.answerCbQuery();
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  if (data === "admin:list") {
    const admin = await getUserByTelegramId(telegramId);
    const tribeId = admin?.tribeId ?? 1;
    const users = await listTribeUsers(tribeId);

    if (users.length === 0) {
      await ctx.editMessageText("Пользователей нет.");
      await ctx.answerCbQuery();
      return;
    }

    const lines = users.map((u) => {
      const name = u.firstName || u.username || "—";
      const roleIcon = u.role === "admin" ? "👑" : "👤";
      return `${roleIcon} ${name} — ID: \`${u.telegramId}\``;
    });

    await ctx.editMessageText(
      `👥 *Пользователи:*\n\n${lines.join("\n")}`,
      { parse_mode: "Markdown" }
    );
    await ctx.answerCbQuery();
    return;
  }

  if (data === "admin:add") {
    cleanExpiredAdminActions();
    adminPendingAction.set(telegramId, { type: "add_user", timestamp: Date.now() });
    await ctx.editMessageText(
      "➕ Отправьте Telegram ID нового пользователя (число).\n\n" +
      "Пользователь может узнать свой ID у @userinfobot."
    );
    await ctx.answerCbQuery();
    return;
  }

  if (data === "admin:remove") {
    const admin = await getUserByTelegramId(telegramId);
    const tribeId = admin?.tribeId ?? 1;
    const users = await listTribeUsers(tribeId);
    const nonAdmins = users.filter((u) => u.role !== "admin");

    if (nonAdmins.length === 0) {
      await ctx.editMessageText("Нет пользователей для удаления.");
      await ctx.answerCbQuery();
      return;
    }

    const buttons = nonAdmins.map((u) => {
      const name = u.firstName || u.username || String(u.telegramId);
      return [Markup.button.callback(`❌ ${name} (${u.telegramId})`, `admin:del:${u.telegramId}`)];
    });

    await ctx.editMessageText("➖ Выберите пользователя для удаления:", {
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
    return;
  }

  // admin:del:<telegramId>
  const delMatch = data.match(/^admin:del:(\d+)$/);
  if (delMatch) {
    const targetId = parseInt(delMatch[1], 10);
    const removed = await removeUserByTelegramId(targetId);
    if (removed) {
      await ctx.editMessageText(`✅ Пользователь ${targetId} удалён.`);
    } else {
      await ctx.editMessageText(`Пользователь ${targetId} не найден.`);
    }
    await ctx.answerCbQuery();
    return;
  }

  // ─── Pending users (applications) ─────────────────────────────────
  if (data === "admin:pending") {
    const pending = await listPendingUsers();
    if (pending.length === 0) {
      await ctx.editMessageText("Нет заявок на рассмотрении.");
      await ctx.answerCbQuery();
      return;
    }

    const buttons = pending.map((u) => {
      const name = u.firstName || u.username || String(u.telegramId);
      return [
        Markup.button.callback(`✅ ${name} (${u.telegramId})`, `admin:approve:${u.telegramId}`),
        Markup.button.callback(`❌`, `admin:reject:${u.telegramId}`),
      ];
    });

    await ctx.editMessageText(`📋 *Заявки (${pending.length}):*`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
    return;
  }

  // admin:approve:<telegramId>
  const approveMatch = data.match(/^admin:approve:(\d+)$/);
  if (approveMatch) {
    const targetId = parseInt(approveMatch[1], 10);
    const approved = await approveUser(targetId);
    if (approved) {
      await ctx.editMessageText(`✅ Пользователь ${targetId} одобрен.`);
      // Notify user
      try {
        await ctx.telegram.sendMessage(targetId, "🎉 Ваша заявка одобрена! Отправьте /start для начала работы.");
      } catch (err) {
        log.error("Failed to notify approved user:", err);
      }
    } else {
      await ctx.editMessageText(`Пользователь ${targetId} не найден или уже одобрен.`);
    }
    await ctx.answerCbQuery();
    return;
  }

  // admin:reject:<telegramId>
  const rejectMatch = data.match(/^admin:reject:(\d+)$/);
  if (rejectMatch) {
    const targetId = parseInt(rejectMatch[1], 10);
    const rejected = await rejectUser(targetId);
    if (rejected) {
      await ctx.editMessageText(`❌ Заявка пользователя ${targetId} отклонена.`);
      // Notify user
      try {
        await ctx.telegram.sendMessage(targetId, "❌ Ваша заявка на доступ отклонена. Вы можете подать заявку повторно.");
      } catch (err) {
        log.error("Failed to notify rejected user:", err);
      }
    } else {
      await ctx.editMessageText(`Пользователь ${targetId} не найден.`);
    }
    await ctx.answerCbQuery();
    return;
  }

  // ─── Tribe management ─────────────────────────────────────────────
  if (data === "admin:tribes") {
    const admin = await getUserByTelegramId(telegramId);
    const tribeId = admin?.tribeId ?? 1;
    const users = await listTribeUsers(tribeId);
    const nonAdmins = users.filter((u) => u.role !== "admin");

    if (nonAdmins.length === 0) {
      await ctx.editMessageText("Нет пользователей для назначения трайба.");
      await ctx.answerCbQuery();
      return;
    }

    const buttons = nonAdmins.map((u) => {
      const name = u.firstName || u.username || String(u.telegramId);
      return [Markup.button.callback(`🏷 ${name}`, `admin:set_tribe:${u.telegramId}`)];
    });

    await ctx.editMessageText("🏷 *Выберите пользователя:*", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
    return;
  }

  // admin:set_tribe:<telegramId>
  const setTribeMatch = data.match(/^admin:set_tribe:(\d+)$/);
  if (setTribeMatch) {
    const targetId = parseInt(setTribeMatch[1], 10);
    const tribes = await listTribes();

    const buttons = tribes.map((t) =>
      [Markup.button.callback(`${t.name}`, `admin:assign_tribe:${targetId}:${t.id}`)]
    );

    await ctx.editMessageText(`🏷 Выберите трайб для пользователя ${targetId}:`, {
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
    return;
  }

  // admin:assign_tribe:<telegramId>:<tribeId>
  const assignTribeMatch = data.match(/^admin:assign_tribe:(\d+):(\d+)$/);
  if (assignTribeMatch) {
    const targetId = parseInt(assignTribeMatch[1], 10);
    const tribeId = parseInt(assignTribeMatch[2], 10);
    const updated = await setUserTribe(targetId, tribeId);
    if (updated) {
      const tribes = await listTribes();
      const tribeName = tribes.find((t) => t.id === tribeId)?.name ?? String(tribeId);
      await ctx.editMessageText(`✅ Пользователь ${targetId} назначен в трайб «${tribeName}».`);
    } else {
      await ctx.editMessageText(`Пользователь ${targetId} не найден.`);
    }
    await ctx.answerCbQuery();
    return;
  }

  // ─── Remove from tribe ──────────────────────────────────────────────
  if (data === "admin:remove_tribe") {
    const admin = await getUserByTelegramId(telegramId);
    const tribeId = admin?.tribeId ?? 1;
    const users = await listTribeUsers(tribeId);
    const nonAdmins = users.filter((u) => u.role !== "admin");

    if (nonAdmins.length === 0) {
      await ctx.editMessageText("Нет пользователей для удаления из трайба.");
      await ctx.answerCbQuery();
      return;
    }

    const buttons = nonAdmins.map((u) => {
      const name = u.firstName || u.username || String(u.telegramId);
      return [Markup.button.callback(`🚫 ${name} (${u.telegramId})`, `admin:untribe:${u.telegramId}`)];
    });

    await ctx.editMessageText("🚫 *Выберите пользователя для удаления из трайба:*", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
    return;
  }

  // admin:untribe:<telegramId>
  const untribeMatch = data.match(/^admin:untribe:(\d+)$/);
  if (untribeMatch) {
    const targetId = parseInt(untribeMatch[1], 10);
    const removed = await removeUserFromTribe(targetId);
    if (removed) {
      await ctx.editMessageText(`✅ Пользователь ${targetId} убран из трайба.`);
    } else {
      await ctx.editMessageText(`Пользователь ${targetId} не найден.`);
    }
    await ctx.answerCbQuery();
    return;
  }

  if (data === "admin:new_tribe") {
    cleanExpiredAdminActions();
    adminPendingAction.set(telegramId, { type: "new_tribe", timestamp: Date.now() });
    await ctx.editMessageText("➕ Введите название нового трайба:");
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery();
}

/**
 * Handle text input when admin is waiting for input (add user or create tribe).
 * Returns true if the message was consumed.
 */
export async function handleAdminTextInput(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (telegramId == null) return false;

  cleanExpiredAdminActions();
  const pending = adminPendingAction.get(telegramId);
  if (!pending) return false;

  if (!isDatabaseAvailable()) {
    adminPendingAction.delete(telegramId);
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return true;
  }

  adminPendingAction.delete(telegramId);

  if (!ctx.message || !("text" in ctx.message)) return false;
  const text = ctx.message.text.trim();

  if (pending.type === "add_user") {
    const newId = parseInt(text, 10);
    if (isNaN(newId) || newId <= 0) {
      await ctx.reply("❌ Некорректный Telegram ID. Должно быть положительное число.");
      return true;
    }

    const user = await addUserByTelegramId(newId);
    if (user) {
      await ctx.reply(`✅ Пользователь ${newId} добавлен.`);
    } else {
      await ctx.reply(`Пользователь ${newId} уже существует.`);
    }
    return true;
  }

  if (pending.type === "new_tribe") {
    if (!text || text.length > 100) {
      await ctx.reply("❌ Название трайба должно быть от 1 до 100 символов.");
      return true;
    }

    try {
      const tribe = await createTribe(text);
      await ctx.reply(`✅ Трайб «${tribe.name}» создан (ID: ${tribe.id}).`);
    } catch (err) {
      log.error("Error creating tribe:", err);
      await ctx.reply("❌ Ошибка при создании трайба.");
    }
    return true;
  }

  return false;
}

/** Handle onboard_request callback — create pending user and notify admin. */
export async function handleOnboardRequest(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return;
  const telegramId = ctx.from?.id;
  if (telegramId == null) {
    await ctx.answerCbQuery();
    return;
  }

  // Check if user already exists
  const exists = await isUserInDb(telegramId);
  if (exists) {
    await ctx.answerCbQuery("Вы уже зарегистрированы.");
    await ctx.editMessageText("Вы уже зарегистрированы. Отправьте /start.");
    return;
  }

  try {
    // Create pending user
    await createPendingUser(
      telegramId,
      ctx.from?.username ?? null,
      ctx.from?.first_name ?? "",
      ctx.from?.last_name ?? null
    );

    await ctx.answerCbQuery("✅ Заявка отправлена!");
    await ctx.editMessageText(
      "✅ Заявка отправлена!\n\nОжидайте одобрения администратора. Вы получите уведомление."
    );

    // Notify admin
    const adminId = getAdminTelegramId();
    if (adminId) {
      const name = ctx.from?.first_name ?? "";
      const username = ctx.from?.username ? `@${ctx.from.username}` : "";
      const userInfo = [name, username].filter(Boolean).join(" ");

      try {
        await ctx.telegram.sendMessage(
          adminId,
          `📬 *Новая заявка на доступ*\n\n` +
          `👤 ${userInfo}\n` +
          `🆔 \`${telegramId}\``,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback("✅ Одобрить", `admin:approve:${telegramId}`),
                Markup.button.callback("❌ Отклонить", `admin:reject:${telegramId}`),
              ],
            ]),
          }
        );
      } catch (err) {
        log.error("Failed to notify admin about new request:", err);
      }
    }
  } catch (err) {
    log.error("Error handling onboard request:", err);
    await ctx.answerCbQuery("Ошибка. Попробуйте позже.");
  }
}
