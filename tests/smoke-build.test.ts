import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const WEBAPP_ROOT = resolve(ROOT, "webapp");

describe("Build artifacts smoke test", () => {
  it("dist/index.js exists (backend build)", () => {
    assert.ok(
      existsSync(resolve(ROOT, "dist", "index.js")),
      "dist/index.js should exist after build"
    );
  });

  it("package.json has required scripts", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
    assert.ok(pkg.scripts.build, "Missing build script");
    assert.ok(pkg.scripts.start, "Missing start script");
    assert.ok(pkg.scripts.dev, "Missing dev script");
    assert.ok(pkg.scripts.typecheck, "Missing typecheck script");
  });

  it("package.json type is module (ESM)", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
    assert.equal(pkg.type, "module");
  });

  it("tsconfig.json has strict mode enabled", () => {
    const tsconfig = JSON.parse(readFileSync(resolve(ROOT, "tsconfig.json"), "utf-8"));
    assert.equal(tsconfig.compilerOptions.strict, true);
  });
});

describe("Shared types smoke test", () => {
  it("shared/types.ts exists", () => {
    assert.ok(existsSync(resolve(ROOT, "src", "shared", "types.ts")));
  });

  it("shared/constants.ts exists", () => {
    assert.ok(existsSync(resolve(ROOT, "src", "shared", "constants.ts")));
  });

  it("shared/types.ts exports ApiResponse type", () => {
    const content = readFileSync(resolve(ROOT, "src", "shared", "types.ts"), "utf-8");
    assert.ok(content.includes("export interface ApiResponse"));
    assert.ok(content.includes("export interface ApiError"));
    assert.ok(content.includes("export type ApiResult"));
  });

  it("shared/types.ts exports all mode DTOs", () => {
    const content = readFileSync(resolve(ROOT, "src", "shared", "types.ts"), "utf-8");
    const requiredDtos = [
      "CalendarEventDto", "ExpenseDto", "GandalfEntryDto", "GoalSetDto",
      "ReminderDto", "WishlistDto", "NotableDateDto", "DigestRubricDto",
      "OsintSearchDto", "ChatDialogDto", "TranscriptionDto",
      "WorkplaceDto", "BloggerChannelDto", "AdminUserDto", "TribeDto",
    ];
    for (const dto of requiredDtos) {
      assert.ok(content.includes(`export interface ${dto}`), `Missing DTO: ${dto}`);
    }
  });
});

describe("API layer structure smoke test", () => {
  it("API router exists", () => {
    assert.ok(existsSync(resolve(ROOT, "src", "api", "router.ts")));
  });

  it("auth middleware exists", () => {
    assert.ok(existsSync(resolve(ROOT, "src", "api", "authMiddleware.ts")));
  });

  it("all route modules exist", () => {
    const routes = [
      "user", "calendar", "expenses", "gandalf", "goals", "reminders",
      "wishlist", "notable-dates", "digest", "osint", "chat", "transcribe",
      "summarizer", "blogger", "broadcast", "admin", "voice",
    ];
    for (const route of routes) {
      assert.ok(
        existsSync(resolve(ROOT, "src", "api", "routes", `${route}.ts`)),
        `Missing route module: ${route}.ts`
      );
    }
  });

  it("all service modules exist", () => {
    const services = [
      "calendarService", "userService", "expenseService", "gandalfService",
      "goalsService", "remindersService", "wishlistService", "notableDatesService",
      "digestService", "osintService", "chatService", "transcribeService",
      "summarizerService", "bloggerService", "broadcastService", "adminService",
      "voiceService",
    ];
    for (const svc of services) {
      assert.ok(
        existsSync(resolve(ROOT, "src", "services", `${svc}.ts`)),
        `Missing service: ${svc}.ts`
      );
    }
  });
});

describe("Webapp structure smoke test", () => {
  it("webapp directory exists", () => {
    assert.ok(existsSync(WEBAPP_ROOT));
  });

  it("webapp package.json exists with build script", () => {
    const pkg = JSON.parse(readFileSync(resolve(WEBAPP_ROOT, "package.json"), "utf-8"));
    assert.ok(pkg.scripts.build, "Missing webapp build script");
    assert.ok(pkg.scripts.dev, "Missing webapp dev script");
  });

  it("webapp has React and Vite dependencies", () => {
    const pkg = JSON.parse(readFileSync(resolve(WEBAPP_ROOT, "package.json"), "utf-8"));
    assert.ok(pkg.dependencies.react, "Missing react dependency");
    assert.ok(pkg.dependencies["react-dom"], "Missing react-dom dependency");
    assert.ok(pkg.devDependencies.vite, "Missing vite dependency");
  });

  it("webapp index.html exists", () => {
    assert.ok(existsSync(resolve(WEBAPP_ROOT, "index.html")));
  });

  it("webapp main entry point exists", () => {
    assert.ok(existsSync(resolve(WEBAPP_ROOT, "src", "main.tsx")));
  });

  it("all page components exist", () => {
    const pages = [
      "ModeSelectorPage", "CalendarPage", "CreateEventPage", "ExpensesPage",
      "GandalfPage", "GoalsPage", "RemindersPage", "WishlistPage",
      "NotableDatesPage", "DigestPage", "OsintPage", "ChatPage",
      "TranscribePage", "SummarizerPage", "BloggerPage", "BroadcastPage",
      "AdminPage",
    ];
    for (const page of pages) {
      assert.ok(
        existsSync(resolve(WEBAPP_ROOT, "src", "pages", `${page}.tsx`)),
        `Missing page: ${page}.tsx`
      );
    }
  });
});
