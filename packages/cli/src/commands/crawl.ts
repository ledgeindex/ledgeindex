import {
  applyRuntimeFlagOverrides,
  loadConfig,
  resolveConfig,
  validateCrawlAiFeatures,
} from "../config.js";
import { getCliInstance, initCliRuntime } from "../cli-runtime.js";
import { PipelineRenderer } from "../pipeline-renderer.js";
import {
  commandArg,
  flagBool,
  flagNumber,
  flagString,
  type ParsedArgs,
} from "../parse-args.js";

export async function runCrawlCommand(args: ParsedArgs): Promise<number> {
  const url = commandArg(args, 0) ?? flagString(args.flags, "url");
  if (!url) {
    console.error(
      "Usage: ledgeindex crawl <url> [--name <name>] [--max-pages N] [--filter] [--enrich] [--discover-nav] [--provider google|openai|deepseek] [--json]",
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
  const aiError = validateCrawlAiFeatures(resolved, args.flags);
  if (aiError) {
    console.error(aiError);
    return 2;
  }

  await initCliRuntime(config);
  const li = getCliInstance();

  const renderer = new PipelineRenderer();
  const json = flagBool(args.flags, "json");

  try {
    const result = await li.crawl({
      url,
      name: flagString(args.flags, "name"),
      maxPages: flagNumber(args.flags, "max-pages"),
      autoFilter: flagBool(args.flags, "filter"),
      enrichExamples: flagBool(args.flags, "enrich"),
      discoverHeaderNav: flagBool(args.flags, "discover-nav"),
      scope: flagString(args.flags, "scope") === "global" ? "global" : "personal",
      onProgress: (update) => renderer.update(update),
    });

    renderer.finish(
      `Done — ${result.name}: ${result.pageCount} pages, ${result.chunkCount} chunks (source ${result.sourceId})`,
    );

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\nSource ID: ${result.sourceId}`);
      console.log(`Ask: ledgeindex ask ${result.sourceId} "your question"`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderer.error(message);
    return 1;
  }
}
