import type { Context } from "telegraf";
import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "telegraf/types";
import { isBootstrapAdmin } from "../middleware/auth.js";
import { getCategories } from "../expenses/repository.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { DB_UNAVAILABLE_MSG } from "../constants.js";
import { logAction } from "../logging/actionLogger.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("categories-command");

/**
 * /categories — просмотр категорий расходов и запуск управления в Mini App.
 * Категории глобальные, поэтому управление доступно только администратору.
 * Полноценное создание/редактирование (emoji, aliases, описание) — в приложении:
 * Расходы → вкладка «Категории».
 */
export async function handleCategoriesCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (!isBootstrapAdmin(telegramId)) {
    await ctx.reply("Управление категориями доступно только администратору.");
    return;
  }

  if (!isDatabaseAvailable()) {
    await ctx.reply(DB_UNAVAILABLE_MSG);
    return;
  }

  try {
    const categories = await getCategories();

    const lines: string[] = ["🗂️ Категории расходов:", ""];
    for (const c of categories) {
      lines.push(`${c.emoji} ${c.name}`);
      if (c.description) lines.push(`   ${c.description}`);
      if (c.aliases.length > 0) lines.push(`   слова: ${c.aliases.join(", ")}`);
    }
    lines.push("");
    lines.push(
      "➕ Добавить категорию можно прямо здесь (кнопка ниже) или в приложении: " +
        "Расходы → вкладка «Категории» (там же изменение и удаление)."
    );

    const webappUrl = process.env.WEBAPP_URL?.trim();
    const rows: InlineKeyboardButton[][] = [
      [Markup.button.callback("➕ Добавить категорию", "catwiz:start")],
    ];
    if (webappUrl) {
      rows.push([Markup.button.webApp("⚙️ Управлять в приложении", webappUrl)]);
    }

    await ctx.reply(lines.join("\n"), Markup.inlineKeyboard(rows));
    logAction(null, telegramId, "expense_categories_view", { count: categories.length });
  } catch (err) {
    log.error("Failed to list categories:", err);
    await ctx.reply("Не удалось получить список категорий. Попробуйте позже.");
  }
}
