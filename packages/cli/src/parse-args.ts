export type ParsedArgs = {
  command?: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
        i += 1;
        continue;
      }
      flags[key] = next;
      i += 2;
      continue;
    }
    positional.push(arg);
    i += 1;
  }

  const [command, subcommand, ...rest] = positional;
  return {
    command,
    subcommand,
    positional: rest,
    flags,
  };
}

export function commandArg(
  args: ParsedArgs,
  index = 0,
): string | undefined {
  if (index === 0 && args.subcommand) return args.subcommand;
  return args.positional[index];
}

export function commandArgs(args: ParsedArgs): string[] {
  if (args.subcommand) return [args.subcommand, ...args.positional];
  return args.positional;
}

export function flagString(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function flagBool(
  flags: Record<string, string | boolean>,
  key: string,
  fallback = false,
): boolean {
  const value = flags[key];
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "0" || lower === "false" || lower === "no") return false;
    return true;
  }
  return fallback;
}

export function flagNumber(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const value = flagString(flags, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
