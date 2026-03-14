/**
 * Lightweight logger with module tags and configurable log level.
 * Format: ISO_TIMESTAMP [LEVEL] [tag] message
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): number {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return LEVELS[env as LogLevel] ?? LEVELS.info;
}

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export function createLogger(tag: string): Logger {
  const minLevel = getConfiguredLevel();

  function log(level: LogLevel, message: string, args: unknown[]): void {
    if (LEVELS[level] < minLevel) return;
    const ts = new Date().toISOString();
    const prefix = `${ts} [${level.toUpperCase()}] [${tag}]`;
    if (args.length === 0) {
      (level === "error" || level === "warn" ? console.error : console.log)(
        `${prefix} ${message}`
      );
    } else {
      (level === "error" || level === "warn" ? console.error : console.log)(
        `${prefix} ${message}`,
        ...args
      );
    }
  }

  return {
    debug: (message, ...args) => log("debug", message, args),
    info: (message, ...args) => log("info", message, args),
    warn: (message, ...args) => log("warn", message, args),
    error: (message, ...args) => log("error", message, args),
  };
}
