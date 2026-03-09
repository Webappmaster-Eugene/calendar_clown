---
name: new-command
description: Создание новой команды бота — от проектирования до интеграции в bot.ts и index.ts. Используй при добавлении нового функционала бота.
---

Создай новую команду бота: $ARGUMENTS

## Шаги

### 1. Проектирование
- Определи, к какой подсистеме относится команда: calendar / openclaw / voice / standalone
- Определи, нужна ли авторизация Google (calendar) или проверка ADMIN_USER_IDS
- Продумай: что происходит при ошибке, отсутствии токенов, пустом вводе

### 2. Создание хендлера
- Создай файл в `src/commands/<command-name>.ts`
- Экспортируй async-функцию `handle<CommandName>`
- Паттерн хендлера:

```typescript
import { Context } from "telegraf";

export async function handleCommandName(ctx: Context): Promise<void> {
  try {
    // 1. Валидация входных данных
    // 2. Проверка авторизации (если нужно)
    // 3. Бизнес-логика
    // 4. Ответ пользователю
  } catch (err) {
    console.error("handleCommandName error:", err);
    await ctx.reply("Ошибка. Попробуйте позже.");
  }
}
```

### 3. Интеграция
- Добавь import и `bot.command(...)` в `src/bot.ts`
- Если команда условная (зависит от env) — оберни в `if (process.env....)` как openclawChat
- Добавь описание команды в массив `defaultCommands` или `openclawCommands` в `src/index.ts`
- Обнови `/help` текст в `src/commands/start.ts`

### 4. Если нужна работа с БД
- Запись опциональна: проверяй наличие pool перед запросом
- Используй параметризованные запросы (`$1, $2...`)
- При необходимости — создай миграцию в `migrations/`

### 5. Проверка
- `npx tsc --noEmit` — нет ошибок типов
- `npm run build` — сборка проходит
- Мысленный прогон: все ветки (success, error, missing auth, empty input)

### 6. Документация
- Обнови README.md секцию «Команды бота»
- Если команда зависит от env — обнови таблицу переменных окружения
