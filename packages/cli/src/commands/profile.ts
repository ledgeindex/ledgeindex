import {
  defaultProfileLenses,
  getLensDefinition,
  parseResearchLensList,
  researchLensIds,
  runProfile,
} from "@ledgeindex/sdk";
import {
  applyRuntimeFlagOverrides,
  loadConfig,
  resolveConfig,
  validateChatProvider,
} from "../config.js";
import {
  commandArg,
  flagBool,
  flagNumber,
  flagString,
  type ParsedArgs,
} from "../parse-args.js";

function formatProgressLine(progress: {
  phase: string;
  lens?: string;
  index?: number;
  total?: number;
  subphase?: string;
}): string {
  const parts = [progress.phase];
  if (progress.lens) parts.push(progress.lens);
  if (progress.subphase) parts.push(progress.subphase);
  if (progress.index != null && progress.total != null) {
    parts.push(`${progress.index + 1}/${progress.total}`);
  }
  return parts.join(" · ");
}

export async function runProfileCommand(args: ParsedArgs): Promise<number> {
  if (flagBool(args.flags, "list-lenses")) {
    for (const id of researchLensIds) {
      const def = getLensDefinition(id);
      console.log(`${id}\t${def.label}`);
    }
    return 0;
  }

  const url = commandArg(args, 0) ?? flagString(args.flags, "url");
  if (!url) {
    console.error(
      "Usage: ledgeindex profile <url> [--lenses a,b,c] [--max-pages N] [--pick-only] [--json] [--list-lenses]",
    );
    return 2;
  }

  let config;
  try {
    config = applyRuntimeFlagOverrides(await loadConfig(), args.flags);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const resolved = resolveConfig(config);
  const providerError = validateChatProvider(resolved);
  if (providerError) {
    console.error(providerError);
    return 2;
  }

  const lensesRaw = flagString(args.flags, "lenses");
  let lenses = defaultProfileLenses();
  if (lensesRaw) {
    try {
      lenses = parseResearchLensList(lensesRaw);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  const json = flagBool(args.flags, "json");

  try {
    const result = await runProfile(
      url,
      {
        lenses,
        maxPages: flagNumber(args.flags, "max-pages"),
        pickOnly: flagBool(args.flags, "pick-only"),
        onLensStart: (lens, index, total) => {
          process.stderr.write(`Lens ${index + 1}/${total}: ${lens}\n`);
        },
        onProgress: (progress) => {
          process.stderr.write(`${formatProgressLine(progress)}\n`);
        },
      },
      {
        dataDir: resolved.dataDir,
        keys: resolved.keys,
        provider: resolved.provider,
      },
    );

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(JSON.stringify(result.profile, null, 2));
      process.stderr.write(
        `\nModel: ${result.modelId} · ${result.lenses.length} lens(es) · ${result.crawl.urlCount} catalog URLs\n`,
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}
