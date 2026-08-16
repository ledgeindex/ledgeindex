import {
  applyRuntimeFlagOverrides,
  loadConfig,
  resolveConfig,
  validateChatProvider,
} from "../config.js";
import { getCliInstance, initCliRuntime } from "../cli-runtime.js";
import { commandArgs, flagBool, flagString, type ParsedArgs } from "../parse-args.js";

const USAGE = `Usage:
  ledgeindex ask <source-id|slug> "your question"
  ledgeindex ask --sources repo-slug,docs-slug "your question"
  ledgeindex ask --all --sources repo-slug,docs-slug "your question"
  ledgeindex ask --set my-stack "your question"

With --sources or --set:
  default (--picker) — LLM picks which sources to read
  --all              — always read every pinned source

Options:
  --provider google|openai|deepseek`;

function printCitations(citations: Array<{ name: string; url: string }>) {
  if (citations.length === 0) return;
  process.stderr.write(`\nCitations (${citations.length}):\n`);
  for (const cite of citations.slice(0, 8)) {
    process.stderr.write(`  - ${cite.name}\n    ${cite.url}\n`);
  }
}

export async function runAskCommand(args: ParsedArgs): Promise<number> {
  const parts = commandArgs(args);
  const pinnedSources = (flagString(args.flags, "sources") ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  const sourceSet = flagString(args.flags, "set");
  const routed = pinnedSources.length > 0 || Boolean(sourceSet);

  // Routed asks take no source argument, so every word is part of the question.
  const sourceToken = routed ? undefined : parts[0];
  const question = (routed ? parts : parts.slice(1)).join(" ").trim();

  if (!question || (!routed && !sourceToken)) {
    console.error(USAGE);
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

  await initCliRuntime(config);
  const li = getCliInstance();

  try {
    if (routed) {
      const sourceMode = flagBool(args.flags, "all")
        ? "all"
        : flagBool(args.flags, "picker")
          ? "picker"
          : "picker";

      process.stderr.write(
        sourceSet
          ? `Asking source set ${sourceSet} (${sourceMode})…\n`
          : `Asking ${pinnedSources.join(", ")} (${sourceMode})…\n`,
      );

      const result = await li.askAcross(question, {
        ...(pinnedSources.length > 0 ? { sources: pinnedSources } : {}),
        ...(sourceSet ? { sourceSet } : {}),
        sourceMode,
      });

      if (result.pickedSources.length > 0) {
        process.stderr.write(
          `Read: ${result.pickedSources
            .map(
              (source: { slug: string; kind: string }) =>
                `${source.slug} (${source.kind})`,
            )
            .join(", ")}\n\n`,
        );
      }

      console.log(result.answer);
      printCitations(result.citations);
      return 0;
    }

    const { sourceId, name } = await li.resolveSource(sourceToken!);
    process.stderr.write(`Asking ${name}…\n`);

    const result = await li.ask(sourceId, question);

    console.log(result.answer);
    printCitations(result.citations);

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}
