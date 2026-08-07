import type { LogLevel } from "@mastra/loggers";

export function resolveMastraLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}
