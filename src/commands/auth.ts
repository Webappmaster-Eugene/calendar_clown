import type { Context } from "telegraf";
import { saveTokenFromCode } from "../calendar/auth.js";

export async function handleAuth(ctx: Context) {
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }
  const text = "text" in ctx.message && typeof ctx.message.text === "string"
    ? ctx.message.text.replace(/^\/auth\s*/i, "").trim()
    : "";
  if (!text) {
    await ctx.reply(
      "Отправьте код после авторизации в Google. Например: /auth 4/0AeD..."
    );
    return;
  }
  try {
    await saveTokenFromCode(text, String(userId));
    await ctx.reply("✅ Календарь привязан. Можете создавать встречи: /new завтра в 15:00");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка авторизации";
    await ctx.reply(`Ошибка: ${msg}`);
  }
}
