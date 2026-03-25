# Архитектура Telegram Mini App

## Оглавление

1. [Что это такое](#что-это-такое)
2. [Технологии](#технологии)
3. [Как всё устроено (общая схема)](#как-всё-устроено)
4. [Backend: HTTP-сервер и маршрутизация](#backend-http-сервер)
5. [Backend: REST API](#backend-rest-api)
6. [Backend: Авторизация (как Telegram подтверждает пользователя)](#авторизация)
7. [Backend: Сервисный слой](#сервисный-слой)
8. [Frontend: React-приложение](#frontend-react)
9. [Frontend: Интеграция с Telegram](#интеграция-с-telegram)
10. [Frontend: Работа с API](#работа-с-api)
11. [Frontend: Голосовой ввод](#голосовой-ввод)
12. [Общие типы (контракт frontend ↔ backend)](#общие-типы)
13. [Потоки данных (примеры)](#потоки-данных)
14. [Безопасность и контроль доступа](#безопасность)
15. [Docker и деплой](#docker-и-деплой)
16. [Структура файлов](#структура-файлов)

---

## Что это такое

**Telegram Mini App** — это веб-приложение, которое открывается **прямо внутри Telegram** (в WebView). Пользователь нажимает кнопку "Открыть" в боте, и вместо обычного чата видит полноценный графический интерфейс: кнопки, формы, списки, переключатели.

### Зачем Mini App, если есть бот?

| Бот | Mini App |
|-----|----------|
| Команды текстом (`/new`, `/today`) | Кнопки, формы, таблицы |
| Один экран — чат | Множество экранов с навигацией |
| Голос → бот → ответ текстом | Голос → кнопка 🎙 → визуальный результат |
| Inline-кнопки (ограниченный UI) | Полноценный React-интерфейс |

**Важно:** Бот продолжает работать параллельно. Mini App — это дополнительный интерфейс к тем же данным и функциям.

---

## Технологии

### Backend (сервер)

| Технология | Зачем |
|-----------|-------|
| **Node.js 20** | Runtime — среда выполнения JavaScript/TypeScript на сервере |
| **TypeScript 5.6** (strict) | Язык — добавляет типизацию к JavaScript, ловит ошибки на этапе компиляции |
| **Hono** | HTTP-фреймворк для REST API (~14KB, быстрый, поддерживает TypeScript) |
| **Telegraf 4.x** | Фреймворк для Telegram-бота (обработка команд, сообщений) |
| **PostgreSQL 16** | База данных — хранит пользователей, расходы, цели, напоминания и т.д. |
| **Redis 7** | Очередь задач для асинхронной транскрибации голоса |
| **Google Calendar API** | Создание/удаление/просмотр событий в календаре пользователя |
| **OpenRouter API** | Транскрибация голоса (STT) и AI-извлечение данных (DeepSeek) |
| **tsup** | Сборщик TypeScript → JavaScript (ESM формат) |

### Frontend (Mini App)

| Технология | Зачем |
|-----------|-------|
| **React 18** | UI-библиотека для построения интерфейса из компонентов |
| **Vite 8** | Сборщик и dev-сервер для React (мгновенный HMR) |
| **React Router 7** | Навигация между страницами (SPA — без перезагрузки) |
| **TanStack React Query** | Управление серверными данными (кеширование, рефетч, оптимистичные обновления) |
| **Telegram WebApp SDK** | JavaScript-библиотека Telegram для интеграции с Mini App |
| **CSS Variables** | Стилизация под тему Telegram (светлая/тёмная) |

### Инфраструктура

| Технология | Зачем |
|-----------|-------|
| **Docker** | Контейнеризация — одинаковое окружение на dev и prod |
| **Dokploy** | Платформа для деплоя Docker-контейнеров на VDS |
| **Traefik** | Reverse proxy — обеспечивает HTTPS, SSL-сертификаты (Let's Encrypt) |

---

## Как всё устроено

### Общая схема

```
┌─────────────────────────────────────────────────────────┐
│                    Telegram                               │
│                                                           │
│  ┌──────────┐         ┌──────────────┐                   │
│  │   Бот    │         │  Mini App    │                   │
│  │  (чат)   │         │  (WebView)   │                   │
│  └────┬─────┘         └──────┬───────┘                   │
│       │                      │                            │
└───────┼──────────────────────┼────────────────────────────┘
        │ Telegraf              │ HTTPS (fetch)
        │ long polling          │ Authorization: tma <initData>
        ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│              Один HTTP-сервер (порт 18790)               │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Telegraf Bot │  │  Hono API    │  │ Static Files   │  │
│  │ (команды,   │  │  /api/*      │  │ (React SPA)    │  │
│  │  голосовые)  │  │  17 модулей  │  │ webapp-dist/   │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────────┘  │
│         │                │                                │
│         ▼                ▼                                │
│  ┌─────────────────────────────┐                         │
│  │     Services (17 штук)      │                         │
│  │  calendarService             │                         │
│  │  expenseService              │                         │
│  │  goalsService ...            │                         │
│  └──────────┬──────────────────┘                         │
│             │                                             │
│    ┌────────┼────────┐                                   │
│    ▼        ▼        ▼                                   │
│  PostgreSQL  Redis  Google Calendar API                   │
│  (данные)  (очередь) (события)                           │
└─────────────────────────────────────────────────────────┘
```

### Ключевой принцип: один сервисный слой, два интерфейса

Бот и Mini App — это два **разных интерфейса** к одному набору **сервисов**. Когда пользователь создаёт событие через бот (`/new Встреча завтра в 15:00`), вызывается `calendarService.createEventFromText()`. Когда он делает то же самое через Mini App, вызывается **тот же самый сервис**.

```
Бот (Telegraf)  ─────┐
                      ├──→  calendarService  ──→  Google Calendar API
Mini App (Hono API) ──┘                       ──→  PostgreSQL
```

---

## Backend: HTTP-сервер

### Файл: `src/oauthServer.ts`

Один HTTP-сервер обрабатывает **всё**:

```
Запрос приходит на порт 18790
  │
  ├── /api/*           → Hono REST API (авторизация + бизнес-логика)
  ├── /oauth/callback  → Google OAuth (привязка календаря)
  ├── /auth/mtproto/*  → MTProto авторизация (для дайджеста)
  ├── /health          → Health check (uptime)
  └── /* (всё остальное) → Static files (React SPA)
```

**Как это работает:**

1. Запрос приходит на `http.createServer`
2. Парсится URL: pathname и query parameters
3. По pathname определяется обработчик
4. Для `/api/*` — запрос конвертируется в Web `Request` и передаётся в Hono
5. Для static файлов — ищется файл в `webapp-dist/`, если не найден — отдаётся `index.html` (SPA fallback)

**SPA fallback** — это важно. Когда React Router переключает страницу на `/calendar`, браузер не перезагружает страницу. Но если пользователь обновит страницу на `/calendar`, сервер должен вернуть `index.html`, а не 404. Для этого любой запрос, который не совпал с реальным файлом, отдаёт `index.html`.

---

## Backend: REST API

### Файл: `src/api/router.ts`

API организован как Hono-приложение с **middleware** (промежуточными обработчиками) и **route modules** (модулями маршрутов).

### Что такое Middleware?

Middleware — это функция, которая выполняется **перед** обработчиком запроса. Как охранник на входе:

```
Запрос → [CORS] → [Auth] → [Approved?] → [Обработчик маршрута] → Ответ
```

1. **CORS** — разрешает запросы с любого домена (нужно для Mini App)
2. **Auth** — проверяет подпись Telegram initData (подлинность пользователя)
3. **Approved** — проверяет что пользователь одобрен (не в статусе "pending")

Если любой middleware отклоняет запрос, обработчик маршрута не вызывается:
- Нет Authorization → `401 Unauthorized`
- Невалидная подпись → `401 Unauthorized`
- Пользователь не одобрен → `403 Forbidden`

### Route Modules (17 модулей)

Каждый модуль — отдельный файл в `src/api/routes/`:

| Модуль | Путь | Что делает |
|--------|------|-----------|
| `user.ts` | `/api/user/*` | Профиль, переключение режимов, OAuth URL |
| `calendar.ts` | `/api/calendar/*` | CRUD событий, today/week списки |
| `expenses.ts` | `/api/expenses/*` | Добавление расходов, отчёты, Excel |
| `gandalf.ts` | `/api/gandalf/*` | База знаний: категории, записи |
| `goals.ts` | `/api/goals/*` | Цели: наборы, прогресс, завершение |
| `reminders.ts` | `/api/reminders/*` | Напоминания: создание, пауза |
| `wishlist.ts` | `/api/wishlist/*` | Вишлист: списки, бронирование |
| `notable-dates.ts` | `/api/notable-dates/*` | Памятные даты |
| `digest.ts` | `/api/digest/*` | Дайджест: рубрики, каналы |
| `osint.ts` | `/api/osint/*` | OSINT-поиск |
| `chat.ts` | `/api/chat/*` | AI-чат: диалоги, сообщения |
| `transcribe.ts` | `/api/transcribe/*` | История транскрибаций |
| `summarizer.ts` | `/api/summarizer/*` | Резюме: рабочие места, достижения |
| `blogger.ts` | `/api/blogger/*` | Блогер: каналы, посты, генерация |
| `broadcast.ts` | `/api/broadcast/*` | Рассылка по трайбу |
| `admin.ts` | `/api/admin/*` | Админка: пользователи, трайбы, статистика |
| `voice.ts` | `/api/voice/*` | Приём аудио, транскрибация |

### Формат ответов API

Все ответы следуют единому формату:

```json
// Успех
{ "ok": true, "data": { ... } }

// Ошибка
{ "ok": false, "error": "Описание ошибки", "code": "ERROR_CODE" }
```

Типы определены в `src/shared/types.ts`:
```typescript
type ApiResult<T> = ApiResponse<T> | ApiError;
```

---

## Авторизация

### Как Telegram подтверждает пользователя?

Это самая важная часть безопасности. Когда Telegram открывает Mini App, он передаёт в WebView специальную строку **initData**. Эта строка содержит:

- ID пользователя
- Имя, username
- Время создания (auth_date)
- **Подпись (hash)** — HMAC-SHA256, подписанная ботовским токеном

### Файл: `src/api/authMiddleware.ts`

**Алгоритм проверки:**

```
1. Frontend отправляет: Authorization: tma <initDataRaw>

2. Backend извлекает initDataRaw и проверяет:
   a) Парсит как URLSearchParams
   b) Извлекает hash
   c) Собирает data_check_string (все параметры кроме hash, отсортированные, через \n)
   d) Вычисляет: secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
   e) Вычисляет: expected_hash = HMAC-SHA256(secret_key, data_check_string)
   f) Сравнивает expected_hash с hash из initData

3. Если совпадает → пользователь подлинный
4. Проверяет auth_date (не старше 24 часов)
5. Парсит user JSON → { id, first_name, username }
6. Загружает профиль из PostgreSQL
```

**Почему это безопасно?** Подделать initData невозможно без знания `BOT_TOKEN`. Telegram подписывает данные на своей стороне, а мы проверяем подпись на своей. Это аналог JWT, но от Telegram.

---

## Сервисный слой

### Директория: `src/services/`

Сервисы — это **чистая бизнес-логика**, отделённая от транспорта (HTTP, Telegram).

**Пример: `calendarService.ts`**

```typescript
// Что делает: парсит текст → создаёт событие в Google Calendar → сохраняет в БД
export async function createEventFromText(
  userId: string,        // ID для Google Calendar API
  telegramId: number,    // ID для БД
  text: string           // "Встреча завтра в 15:00"
): Promise<CreateEventResult> {

  // 1. Парсинг текста (chrono-node, русский язык)
  const parsed = parseEventText(text);
  // → { title: "Встреча", start: Date, end: Date }

  // 2. Создание в Google Calendar
  const event = await createEvent(parsed.title, parsed.start, parsed.end, userId);

  // 3. Сохранение в PostgreSQL (для истории)
  await saveEventToDb(telegramId, { ... });

  // 4. Возврат DTO (Data Transfer Object)
  return { event: toDto(event), savedToDb: true };
}
```

**Почему сервисный слой нужен?**

Без него бизнес-логика была бы размазана по command handlers бота:

```
БЕЗ сервисного слоя:
  Бот: handleNew() { парсинг + Google API + БД + форматирование }
  API: POST /events { парсинг + Google API + БД + JSON }
  → Дублирование кода!

С сервисным слоем:
  Бот: handleNew() { result = calendarService.create(); ctx.reply(format(result)); }
  API: POST /events { result = calendarService.create(); return json(result); }
  → Логика в одном месте
```

---

## Frontend: React-приложение

### Структура (`webapp/src/App.tsx`)

```
<QueryClientProvider>         ← Кеширование API-запросов
  <TelegramProvider>          ← Инициализация Telegram SDK
    <BrowserRouter>           ← SPA-навигация
      <AppShell>              ← BackButton + обёртка
        <ErrorBoundary>       ← Обработка крашей React
          <Routes>
            / → ModeSelectorPage    (сетка режимов)
            /calendar → CalendarPage
            /calendar/new → CreateEventPage
            /expenses → ExpensesPage
            /gandalf → GandalfPage
            ... (17 страниц)
          </Routes>
        </ErrorBoundary>
      </AppShell>
    </BrowserRouter>
  </TelegramProvider>
</QueryClientProvider>
```

### Что делает каждый Provider?

**QueryClientProvider** — обёртка TanStack React Query. Позволяет компонентам:
- Автоматически кешировать ответы API (не перезапрашивать при возврате на страницу)
- Показывать loading/error состояния
- Обновлять данные после мутаций (создание, удаление)

**TelegramProvider** — инициализирует Telegram WebApp SDK:
- Вызывает `webApp.expand()` (раскрыть на весь экран)
- Вызывает `webApp.ready()` (убрать splash screen)
- Передаёт `initData` в API client для авторизации
- Предоставляет доступ к `webApp.BackButton`, `webApp.MainButton`, `webApp.HapticFeedback`

**BrowserRouter** — React Router для SPA-навигации без перезагрузки страницы.

**AppShell** — управляет кнопкой "Назад" в Telegram:
- На главной странице (`/`) — скрывает BackButton
- На любой другой — показывает BackButton, по нажатию → `navigate(-1)`

**ErrorBoundary** — если React-компонент крашится, показывает "Произошла ошибка" вместо белого экрана.

---

## Интеграция с Telegram

### Файл: `webapp/src/hooks/useTelegram.tsx`

При открытии Mini App:

```
1. Telegram загружает index.html в WebView
2. Скрипт telegram-web-app.js создаёт window.Telegram.WebApp
3. React mount → TelegramProvider useEffect:
   a) Берёт window.Telegram.WebApp
   b) Вызывает expand() + ready()
   c) Извлекает initData (подпись)
   d) Вызывает setInitData(webApp.initData) → API client запоминает для авторизации
   e) Сохраняет в React context: { webApp, user, colorScheme }
```

**Что даёт Telegram SDK?**

```typescript
webApp.expand()                           // Раскрыть на весь экран
webApp.ready()                            // Убрать loading indicator
webApp.BackButton.show() / .hide()        // Кнопка "Назад"
webApp.MainButton.show() / .setText()     // Кнопка внизу экрана
webApp.HapticFeedback.impactOccurred()    // Вибрация
webApp.showConfirm("Удалить?", cb)        // Нативный confirm dialog
webApp.openLink(url)                      // Открыть ссылку в in-app browser
webApp.colorScheme                        // "light" или "dark"
// CSS переменные: --tg-theme-bg-color, --tg-theme-text-color, ...
```

---

## Работа с API

### Файл: `webapp/src/api/client.ts`

Все API-вызовы идут через один HTTP-клиент:

```typescript
// Каждый запрос автоматически добавляет:
headers["Authorization"] = `tma ${initDataRaw}`;
headers["Content-Type"] = "application/json";

// Таймаут: 30 секунд (AbortController)

// Ответ парсится как ApiResult<T>:
// { ok: true, data: T }  → возвращает data
// { ok: false, error }   → throw ApiError
```

### Как страницы используют API (TanStack React Query)

**Загрузка данных:**

```tsx
// CalendarPage.tsx
const { data: events, isLoading, error } = useQuery({
  queryKey: ["calendar", "today"],          // Ключ кеша
  queryFn: () => api.get<CalendarEventDto[]>("/api/calendar/today"),
});

// React Query автоматически:
// - Показывает isLoading при первом запросе
// - Кеширует результат на 30 секунд (staleTime)
// - Повторяет при ошибке (retry: 1)
// - Обновляет при возврате на страницу (после staleTime)
```

**Мутации (создание/удаление):**

```tsx
const queryClient = useQueryClient();

const deleteMutation = useMutation({
  mutationFn: (id: string) => api.del(`/api/calendar/events/${id}`),
  onSuccess: () => {
    // После удаления → обновить список событий
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
  },
});

// Использование:
deleteMutation.mutate(eventId);
// deleteMutation.isPending → true пока запрос выполняется
```

---

## Голосовой ввод

### Файл: `webapp/src/hooks/useVoiceRecorder.ts`

**Как это работает:**

```
1. Пользователь нажимает 🎙
2. Браузер запрашивает доступ к микрофону (navigator.mediaDevices.getUserMedia)
3. Создаётся MediaRecorder с форматом:
   - WebM/Opus (Android, Chrome)
   - MP4/AAC (iOS, Safari)
4. Аудио записывается чанками по 250мс
5. Таймер показывает длительность записи
6. Пользователь нажимает "Отправить"
7. Чанки склеиваются в Blob
8. Blob отправляется через FormData на POST /api/voice/transcribe
9. Backend: сохраняет файл → транскрибирует → возвращает текст
```

**На бекенде:** тот же пайплайн, что и для голосовых сообщений бота — OpenRouter STT (Gemini Flash или GPT Audio Mini).

---

## Общие типы

### Файлы: `src/shared/types.ts`, `src/shared/constants.ts`

Эти файлы — **контракт** между frontend и backend. Оба импортируют одни и те же типы:

```
Backend:  import type { CalendarEventDto } from "../shared/types.js";
Frontend: import type { CalendarEventDto } from "@shared/types";
                                                   ↑ path alias в vite.config.ts
```

**Зачем?** Если backend изменит формат ответа, TypeScript сразу покажет ошибку во frontend. Невозможно случайно сломать API-контракт.

**Примеры типов:**

```typescript
// Универсальный ответ API
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

// Профиль пользователя
interface UserProfile {
  telegramId: number;
  firstName: string;
  role: "admin" | "user";
  status: "pending" | "approved";
  mode: UserMode;            // текущий режим
  hasCalendarLinked: boolean; // привязан ли Google Calendar
  hasTribe: boolean;         // состоит ли в трайбе
}

// Режимы (15 штук)
type UserMode = "calendar" | "expenses" | "transcribe" | "digest" | ...;
```

**Константы (`constants.ts`):**

```typescript
// Метаданные для UI (emoji, названия, описания)
MODE_LABELS = {
  calendar: { label: "Календарь", emoji: "📅", description: "Управление встречами" },
  expenses: { label: "Расходы", emoji: "💰", description: "Учёт и аналитика расходов" },
  ...
};

// Категории доступа
INDIVIDUAL_MODES = ["calendar", "transcribe", "gandalf", "neuro", "goals", "reminders"];
TRIBE_MODES = ["expenses", "digest", "notable_dates", "wishlist", "osint", "summarizer", "blogger"];
ADMIN_MODES = ["broadcast", "admin"];
```

---

## Потоки данных

### Создание события через текст

```
[Пользователь]  Вводит "Встреча с командой завтра в 15:00" → нажимает "Создать"
       │
       ▼
[React]  CreateEventPage → mutation.mutate({ text: "..." })
       │
       ▼
[API Client]  POST /api/calendar/events  { text: "Встреча с командой завтра в 15:00" }
              Headers: Authorization: tma <initData>
       │
       ▼
[Hono Middleware]  authMiddleware → проверка HMAC → OK
                   requireApproved → проверка статуса → OK
       │
       ▼
[Route]  calendar.ts → calendarService.createEventFromText(userId, telegramId, text)
       │
       ▼
[Service]  1) parseEventText(text) → chrono-node → { title: "Встреча с командой", start, end }
           2) createEvent(title, start, end, userId) → Google Calendar API → CalendarEvent
           3) saveEventToDb() → PostgreSQL (calendar_events таблица)
       │
       ▼
[Route]  → { ok: true, data: { event: CalendarEventDto, savedToDb: true } }
       │
       ▼
[React]  onSuccess → queryClient.invalidateQueries(["calendar"]) → auto-navigate to /calendar
         → Список событий обновляется автоматически
```

### Открытие Mini App

```
[Пользователь]  Нажимает "Открыть" в боте
       │
       ▼
[Telegram]  Открывает WebView → загружает https://domain.com/
       │
       ▼
[Сервер]  GET / → index.html (из webapp-dist/)
          → Загружается React SPA + telegram-web-app.js
       │
       ▼
[React]  TelegramProvider → webApp.expand() + ready() + setInitData()
       │
       ▼
[React]  ModeSelectorPage → GET /api/user/me
         → Сервер проверяет initData, загружает профиль
         → Показывает сетку доступных режимов
```

---

## Безопасность

### Аутентификация
- **Telegram initData** — HMAC-SHA256, подписанный BOT_TOKEN
- **Срок действия** — 24 часа (после этого нужно переоткрыть Mini App)
- **Без паролей** — Telegram уже авторизовал пользователя

### Авторизация (контроль доступа)
- **Роли**: admin, user
- **Статусы**: pending (заявка), approved (одобрен)
- **Режимы**: individual (без трайба), tribe (нужен трайб), admin (только админ)
- Middleware `requireApproved()` блокирует неодобренных пользователей
- `canAccessMode()` проверяет доступ к конкретному режиму

### Google Calendar OAuth
- Токены хранятся **per-user**: `data/tokens/<telegram_id>.json`
- Автоматическое обновление refresh token
- OAuth redirect требует HTTPS (Traefik/Let's Encrypt)

---

## Docker и деплой

### Dockerfile (3 стадии сборки)

```
Stage 1: backend-builder
  - Node 20 + git
  - npm ci → установка зависимостей
  - npm run build → TypeScript → JavaScript (dist/)

Stage 2: frontend-builder
  - Node 20
  - npm ci → установка зависимостей React/Vite
  - npm run build → React → статические файлы (webapp/dist/)
  - Копирует shared типы для сборки

Stage 3: runtime
  - Node 20 + ffmpeg (для аудио)
  - Копирует только продакшн-зависимости
  - Копирует dist/ (backend) + webapp-dist/ (frontend) + drizzle (миграции)
  - Создаёт data/tokens + data/voice
  - EXPOSE 18790
  - CMD: node dist/index.js
```

### docker-compose.yml

```
PostgreSQL 16  ←────→  Bot + API (Node.js)  ←────→  Traefik (HTTPS)
Redis 7        ←────→     ↑                          ↑
                          │                     Let's Encrypt
                     порт 18790                  SSL cert
```

---

## Структура файлов

```
voice-meet-planner/
├── src/
│   ├── index.ts              # Точка входа: запуск бота, БД, API
│   ├── bot.ts                # Telegraf бот (30+ команд)
│   ├── oauthServer.ts        # HTTP-сервер (API + OAuth + static)
│   ├── api/                  # REST API (Hono)
│   │   ├── router.ts         # Главный роутер + middleware
│   │   ├── authMiddleware.ts # Telegram initData HMAC
│   │   └── routes/           # 17 route-модулей
│   ├── services/             # 17 бизнес-сервисов
│   ├── shared/               # Общие типы и константы
│   │   ├── types.ts          # API-контракты (DTO)
│   │   └── constants.ts      # Лейблы режимов, лимиты
│   ├── calendar/             # Google Calendar (OAuth, API, парсинг)
│   ├── commands/             # Обработчики команд бота
│   ├── voice/                # Транскрибация (STT, intent extraction)
│   ├── expenses/             # Расходы (парсер, репозиторий)
│   ├── db/                   # PostgreSQL (Drizzle ORM, миграции)
│   └── utils/                # Утилиты (markdown, telegram, logger)
├── webapp/                   # React Mini App
│   ├── src/
│   │   ├── App.tsx           # Корень + Router
│   │   ├── api/client.ts     # HTTP-клиент с auth
│   │   ├── hooks/            # useTelegram, useVoiceRecorder
│   │   ├── components/       # ErrorBoundary, AppShell, VoiceButton
│   │   ├── pages/            # 17 страниц (все на русском)
│   │   └── styles/           # CSS с Telegram-темизацией
│   ├── vite.config.ts        # Vite + proxy + @shared alias
│   └── tsconfig.json         # TypeScript config
├── tests/                    # 80 тестов (unit + smoke)
├── Dockerfile                # Multi-stage build
├── docker-compose.yml        # PostgreSQL + Redis + Bot
└── package.json              # Scripts: build, dev, test
```
