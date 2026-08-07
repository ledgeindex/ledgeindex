/** Internal helpers shared across primitives. Not part of the public API surface. */
import { pathToFileURL } from "node:url";

export function hfTokenFromEnv(): string | undefined {
  const token = process.env.HF_TOKEN?.trim() || process.env.HUGGING_FACE_HUB_TOKEN?.trim() || undefined;
  return token || undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** True when this module is being executed directly (e.g. `tsx src/primitives/inspect.ts`). */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return moduleUrl === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}
