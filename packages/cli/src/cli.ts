import { parseArgs } from "./parse-args.js";

function printHelp() {
  console.log(`ledgeindex — standalone docs crawl + ask + profile

Runs in-process via @ledgeindex/sdk — no HTTP server.

Usage:
  ledgeindex crawl <url>              Crawl + index (no model key required)
  ledgeindex ask <source> "question"    Ask an indexed source (requires model key)
  ledgeindex ask --sources a,b "q"    Ask across sources; picker reads code, docs, or both
  ledgeindex ask --all --sources a,b "q"  Always read every pinned source
  ledgeindex ask --set my-stack "q"   Same, choosing within a saved source set
  ledgeindex check-updates <source>   List new, updated, and removed pages (no model key)
  ledgeindex apply-updates <source>   Check for changes and update the index
  ledgeindex profile <url>            Site research profile (requires model key)
  ledgeindex config show|set          Model keys + data directory

Crawl options:
  --filter                            LLM URL cleanup after crawl (needs model key)
  --enrich                            Example enrichment during ingest (needs model key)
  --max-pages N                       Cap discovered pages

Update check options (check-updates / apply-updates):
  --mode probe|discover|selected        probe = HEAD + sitemap (default, lightweight)
                                        discover = full re-crawl; selected = re-fetch every indexed page
  --json                              Full result JSON

Profile options:
  --lenses identity,pricing           Subset of lenses (default: all 14)
  --max-pages N                       Cap site catalog crawl
  --pick-only                         Pick URLs only; skip fetch + synth
  --list-lenses                       Print lens ids and exit
  --json                              Full result JSON (default: merged profile only)

Provider (optional, for ask / profile / --filter / --enrich):
  ledgeindex config set provider google   Default: google | openai | deepseek | auto
  ledgeindex crawl <url> --provider openai --filter

Setup:
  ledgeindex crawl https://docs.example.com
  ledgeindex config set google <key>
  ledgeindex ask my-source "How do I install it?"
  ledgeindex profile https://example.com --lenses identity,capabilities

Keys (config or env) — for ask, profile, --filter, and --enrich:
  openai / OPENAI_API_KEY
  google / GOOGLE_GENERATIVE_AI_API_KEY
  deepseek / DEEPSEEK_API_KEY
  cohere / COHERE_API_KEY (optional rerank on ask)

Data: ~/.ledgeindex/data
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (
    !args.command ||
    args.command === "help" ||
    args.flags.help === true
  ) {
    printHelp();
    process.exit(0);
  }

  let code = 2;
  switch (args.command) {
    case "crawl":
      code = await (await import("./commands/crawl.js")).runCrawlCommand(args);
      break;
    case "ask":
      code = await (await import("./commands/ask.js")).runAskCommand(args);
      break;
    case "config":
      code = await (await import("./commands/config.js")).runConfigCommand(args);
      break;
    case "profile":
      code = await (await import("./commands/profile.js")).runProfileCommand(args);
      break;
    case "check-updates":
    case "checkforupdates":
      code = await (
        await import("./commands/check-updates.js")
      ).runCheckUpdatesCommand(args);
      break;
    case "apply-updates":
    case "applyupdates":
      code = await (
        await import("./commands/apply-updates.js")
      ).runApplyUpdatesCommand(args);
      break;
    case "refresh":
      code = await (
        await import("./commands/check-updates.js")
      ).runCheckUpdatesCommand(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      code = 2;
  }

  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
