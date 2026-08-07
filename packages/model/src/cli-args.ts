/** Minimal `--flag value` / `--flag` CLI argument parsing, shared by all `model:*` scripts. */

export type CliArgs = Record<string, string | boolean>;

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

export function flagString(args: CliArgs, key: string, fallback: string): string;
export function flagString(args: CliArgs, key: string, fallback?: string): string | undefined;
export function flagString(args: CliArgs, key: string, fallback?: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

export function flagNumber(args: CliArgs, key: string, fallback: number): number {
  const v = args[key];
  if (typeof v !== "string") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function flagBool(args: CliArgs, key: string, fallback = false): boolean {
  const v = args[key];
  if (v === true) return true;
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (lower === "0" || lower === "false" || lower === "no") return false;
    return true;
  }
  return fallback;
}
