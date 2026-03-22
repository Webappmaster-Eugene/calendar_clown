import { DEEPSEEK_MODEL, OSINT_QUERIES_LIMIT, OSINT_PHASE2_QUERIES_LIMIT } from "../constants.js";
import { callOpenRouter } from "../utils/openRouterClient.js";
import { tryParseJson } from "../utils/parseJson.js";
import { createLogger } from "../utils/logger.js";
import type { OsintParsedSubject, IntermediateAnalysis } from "./types.js";

const log = createLogger("osint-parser");

const PARSE_PROMPT = `Ты — OSINT-аналитик. Из текста пользователя извлеки объект поиска.

Верни строго JSON (без markdown):
{
  "name": "полное имя или название",
  "lastName": "фамилия (если есть)",
  "firstName": "имя (если есть)",
  "patronymic": "отчество (если есть)",
  "inn": "ИНН (если указан)",
  "isProfessionalTech": false,
  "aliases": ["возможные варианты написания"],
  "phone": "номер телефона если есть",
  "email": "email если есть",
  "city": "город если указан",
  "company": "компания если указана",
  "socialMedia": ["ссылки или юзернеймы соцсетей"],
  "searchType": "person|company|phone|email|general",
  "sufficient": true
}

Поле "lastName/firstName/patronymic" — разбей ФИО на составные части если это человек.
Поле "inn" — ИНН если указан в тексте (10 или 12 цифр).
Поле "isProfessionalTech" = true, если из контекста понятно что человек связан с IT/разработкой/технологиями (упоминается программист, разработчик, DevOps, CTO, github, habr и т.п.). Иначе false.
Поле "sufficient" = true, если информации достаточно для осмысленного поиска (есть хотя бы имя, телефон, email или название компании).
Поле "sufficient" = false, если запрос слишком расплывчатый (например, просто "Иван" без фамилии/города/компании).

Если поле неизвестно — не включай его или ставь null.`;

export interface ParseResult {
  subject: OsintParsedSubject | null;
  sufficient: boolean;
}

/** Parse user's query text into structured OSINT search subject. */
export async function parseSearchSubject(queryText: string): Promise<ParseResult> {
  try {
    const raw = await callOpenRouter({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: PARSE_PROMPT },
        { role: "user", content: queryText },
      ],
      temperature: 0.1,
    });

    if (!raw) {
      log.warn("Empty response from query parser");
      return { subject: null, sufficient: false };
    }

    const parsed = tryParseJson(raw);
    if (!parsed) {
      log.warn("Failed to parse query parser response:", raw);
      return { subject: null, sufficient: false };
    }

    const sufficient = parsed.sufficient === true;
    const subject: OsintParsedSubject = {
      name: String(parsed.name ?? ""),
      searchType: validateSearchType(parsed.searchType),
      ...(parsed.lastName ? { lastName: String(parsed.lastName) } : {}),
      ...(parsed.firstName ? { firstName: String(parsed.firstName) } : {}),
      ...(parsed.patronymic ? { patronymic: String(parsed.patronymic) } : {}),
      ...(parsed.inn ? { inn: String(parsed.inn) } : {}),
      ...(parsed.isProfessionalTech === true ? { isProfessionalTech: true } : {}),
      ...(parsed.aliases ? { aliases: toStringArray(parsed.aliases) } : {}),
      ...(parsed.phone ? { phone: String(parsed.phone) } : {}),
      ...(parsed.email ? { email: String(parsed.email) } : {}),
      ...(parsed.city ? { city: String(parsed.city) } : {}),
      ...(parsed.company ? { company: String(parsed.company) } : {}),
      ...(parsed.socialMedia ? { socialMedia: toStringArray(parsed.socialMedia) } : {}),
    };

    return { subject, sufficient };
  } catch (err) {
    log.error("Query parser error:", err);
    return { subject: null, sufficient: false };
  }
}

const GENERATE_QUERIES_PROMPT = `Ты — OSINT-аналитик. На основе структурированных данных об объекте поиска сгенерируй 30-35 поисковых запросов для веб-поиска.

Запросы должны покрывать следующие категории:

**Общий веб (2-3 запроса):**
- Точное совпадение имени/названия в кавычках
- Имя + город/компания

**Госреестры (4-5 запросов):**
- "ФИО" site:nalog.ru (ЕГРЮЛ/ЕГРИП)
- "ФИО" site:fssp-gov.ru (ФССП, исполнительные производства)
- "ФИО" site:sudact.ru (судебные решения)
- "ФИО" site:bankrot.fedresurs.ru (банкротство)
- ИНН если есть — поиск по ИНН

**Финансы и бизнес (3-4 запроса):**
- "ФИО" site:rusprofile.ru (данные о компаниях, выручка, учредители)
- "ФИО" site:list-org.com OR site:checko.ru (реестры юрлиц)
- "ФИО" учредитель OR директор ООО
- "ФИО" site:arbitr.ru (арбитражные дела)

**Недвижимость и адреса (2 запроса):**
- "ФИО" site:rosreestr.gov.ru OR site:reformagkh.ru
- "ФИО" [город] адрес OR собственник

**Соцсети (4-5 запросов):**
- "ФИО" site:vk.com
- "ФИО" site:ok.ru
- "ФИО" site:instagram.com
- "ФИО" site:facebook.com
- "ФИО" site:linkedin.com
- Если isProfessionalTech=true: "ФИО" site:habr.com, "ФИО" site:github.com

**Фотографии (2 запроса):**
- "ФИО" site:pikabu.ru OR site:drive2.ru (фото, профили)
- "ФИО" фото OR фотография

**Биография и образование (2 запроса):**
- "ФИО" site:wikipedia.org OR site:who-is-who.ru
- "ФИО" образование OR университет OR диссертация

**Телефон/email (1-2 запроса):**
- Телефон или email если указаны

**Профессиональные/СМИ (2 запроса):**
- Упоминания в новостях, профессиональный контекст

**Утечки/базы данных (2 запроса):**
- "ФИО" утечка OR слив OR breach
- "email/phone" пробив OR база

**Автомобили (1 запрос):**
- "ФИО" site:avto-nomer.ru OR автомобиль OR госномер

**Суды расширенно (2 запроса):**
- "ФИО" site:ras.arbitr.ru
- "ФИО" site:sudrf.ru мировой суд

**Резюме/работа (2 запроса):**
- "ФИО" site:hh.ru резюме
- "ФИО" site:superjob.ru

**Форумы (2 запроса):**
- "ФИО" site:forum OR форум
- "ФИО" site:otzovik.com OR irecommend.ru

Верни строго JSON массив строк (без markdown):
["запрос 1", "запрос 2", ...]`;

/** Generate search queries from parsed subject. */
export async function generateSearchQueries(subject: OsintParsedSubject): Promise<string[]> {
  try {
    const raw = await callOpenRouter({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: GENERATE_QUERIES_PROMPT },
        { role: "user", content: JSON.stringify(subject) },
      ],
      temperature: 0.3,
    });

    if (!raw) return buildFallbackQueries(subject);

    const stripped = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      const queries = JSON.parse(stripped);
      if (Array.isArray(queries) && queries.length > 0) {
        return queries.filter((q): q is string => typeof q === "string").slice(0, OSINT_QUERIES_LIMIT);
      }
    } catch {
      // fall through to fallback
    }

    return buildFallbackQueries(subject);
  } catch (err) {
    log.error("Query generation error:", err);
    return buildFallbackQueries(subject);
  }
}

const FOLLOW_UP_PROMPT = `Ты — OSINT-аналитик. На основе промежуточных результатов поиска сгенерируй 10-15 целевых follow-up запросов для углублённого поиска.

Фокусируйся на:
- Углублённый поиск обнаруженных связанных лиц и компаний
- Поиск по найденным ИНН, телефонам, адресам
- Site-specific запросы по обнаруженным профилям и платформам
- Перекрёстная проверка ключевых фактов через альтернативные источники
- Поиск по обнаруженным юзернеймам, никнеймам, alias'ам

Верни строго JSON массив строк (без markdown):
["запрос 1", "запрос 2", ...]`;

/** Generate follow-up queries based on Phase 1 intermediate analysis. */
export async function generateFollowUpQueries(
  analysis: IntermediateAnalysis,
  subject: OsintParsedSubject
): Promise<string[]> {
  try {
    const context = `Объект поиска: ${JSON.stringify(subject)}

Ключевые находки Фазы 1:
${analysis.keyFindings}

Обнаруженные связанные сущности: ${analysis.discoveredEntities.join(", ")}

Уже найденные профили: ${analysis.profileUrls.join(", ")}`;

    const raw = await callOpenRouter({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: FOLLOW_UP_PROMPT },
        { role: "user", content: context },
      ],
      temperature: 0.3,
    });

    if (!raw) return [];

    const stripped = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      const queries = JSON.parse(stripped);
      if (Array.isArray(queries) && queries.length > 0) {
        return queries.filter((q): q is string => typeof q === "string").slice(0, OSINT_PHASE2_QUERIES_LIMIT);
      }
    } catch {
      // ignore parse errors
    }

    return [];
  } catch (err) {
    log.error("Follow-up query generation error:", err);
    return [];
  }
}

function buildFallbackQueries(subject: OsintParsedSubject): string[] {
  const queries: string[] = [];
  const name = subject.name;
  if (name) {
    // Общий веб
    queries.push(`"${name}"`);
    if (subject.city) queries.push(`"${name}" ${subject.city}`);
    if (subject.company) queries.push(`"${name}" ${subject.company}`);
    // Госреестры
    queries.push(`"${name}" site:nalog.ru`);
    queries.push(`"${name}" site:fssp-gov.ru`);
    queries.push(`"${name}" site:sudact.ru`);
    queries.push(`"${name}" site:bankrot.fedresurs.ru`);
    // Финансы и бизнес
    queries.push(`"${name}" site:rusprofile.ru`);
    queries.push(`"${name}" site:list-org.com OR site:checko.ru`);
    queries.push(`"${name}" учредитель OR директор ООО`);
    queries.push(`"${name}" site:arbitr.ru`);
    // Недвижимость и адреса
    queries.push(`"${name}" site:rosreestr.gov.ru OR site:reformagkh.ru`);
    if (subject.city) queries.push(`"${name}" ${subject.city} адрес OR собственник`);
    // Соцсети
    queries.push(`"${name}" site:vk.com`);
    queries.push(`"${name}" site:ok.ru`);
    queries.push(`"${name}" site:instagram.com`);
    queries.push(`"${name}" site:linkedin.com`);
    if (subject.isProfessionalTech) {
      queries.push(`"${name}" site:habr.com`);
      queries.push(`"${name}" site:github.com`);
    }
    // Фотографии
    queries.push(`"${name}" site:pikabu.ru OR site:drive2.ru`);
    queries.push(`"${name}" фото OR фотография`);
    // Биография и образование
    queries.push(`"${name}" site:wikipedia.org OR site:who-is-who.ru`);
    queries.push(`"${name}" образование OR университет`);
    // Утечки/базы данных
    queries.push(`"${name}" утечка OR слив OR breach`);
    // Автомобили
    queries.push(`"${name}" site:avto-nomer.ru OR автомобиль OR госномер`);
    // Суды расширенно
    queries.push(`"${name}" site:ras.arbitr.ru`);
    queries.push(`"${name}" site:sudrf.ru мировой суд`);
    // Резюме/работа
    queries.push(`"${name}" site:hh.ru резюме`);
    queries.push(`"${name}" site:superjob.ru`);
    // Форумы
    queries.push(`"${name}" site:forum OR форум`);
    queries.push(`"${name}" site:otzovik.com OR irecommend.ru`);
  }
  if (subject.inn) queries.push(`ИНН ${subject.inn}`);
  if (subject.phone) {
    queries.push(`"${subject.phone}"`);
    queries.push(`"${subject.phone}" пробив OR база`);
  }
  if (subject.email) {
    queries.push(`"${subject.email}"`);
    queries.push(`"${subject.email}" пробив OR база`);
  }
  return queries.length > 0 ? queries : [`${name || subject.phone || subject.email || "unknown"}`];
}

function validateSearchType(val: unknown): OsintParsedSubject["searchType"] {
  const valid = ["person", "company", "phone", "email", "general"];
  if (typeof val === "string" && valid.includes(val)) {
    return val as OsintParsedSubject["searchType"];
  }
  return "general";
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === "string");
  return [];
}
