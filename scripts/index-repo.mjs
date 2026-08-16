/**
 * Index a git repo into ~/.ledgeindex/data (or LEDGEINDEX_DATA_DIR).
 *
 *   node ledgeindex/scripts/index-repo.mjs https://github.com/browserbase/stagehand stagehand
 *   node ledgeindex/scripts/index-repo.mjs https://github.com/org/repo my-repo --extensions ts,tsx
 *   node ledgeindex/scripts/index-repo.mjs https://github.com/org/repo my-repo --include-readme --extensions ts,md
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();
const { createLedgeIndex } = await import("../packages/sdk/dist/index.js");

function parseArgs(argv) {
  let githubUrl;
  let name;
  let extensions;
  let includeTests = false;
  let includeReadme = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--extensions") {
      const raw = argv[++i] ?? "";
      extensions = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--include-tests") {
      includeTests = true;
      continue;
    }
    if (arg === "--include-readme") {
      includeReadme = true;
      continue;
    }
    if (!githubUrl) githubUrl = arg;
    else if (!name) name = arg;
  }

  return { githubUrl, name, extensions, includeTests, includeReadme };
}

const { githubUrl, name, extensions, includeTests, includeReadme } = parseArgs(
  process.argv.slice(2),
);

if (!githubUrl) {
  console.error(
    "Usage: node scripts/index-repo.mjs <github-url> [name] [--extensions ts,tsx] [--include-tests] [--include-readme]",
  );
  process.exit(2);
}

function logProgress(update) {
  switch (update.phase) {
    case "clone":
      console.log(`[clone] ${update.detail}`);
      break;
    case "scan": {
      const pct = Math.round((update.current / update.total) * 100);
      const file = update.filePath ? ` ${update.filePath}` : "";
      process.stdout.write(
        `\r[scan] ${update.current}/${update.total} (${pct}%)${file}   `,
      );
      if (update.current === update.total) console.log();
      break;
    }
    case "chunking":
    case "embedding":
    case "storing": {
      const pct = Math.round((update.current / update.total) * 100);
      const label = update.sectionUrl
        ? ` ${update.sectionUrl.split("/").pop()}`
        : "";
      process.stdout.write(
        `\r[${update.phase}] ${update.current}/${update.total} (${pct}%)${label}   `,
      );
      if (update.current === update.total) console.log();
      break;
    }
  }
}

const li = await createLedgeIndex({
  dataDir: process.env.LEDGEINDEX_DATA_DIR,
});

const started = Date.now();
const result = await li.indexRepo({
  githubUrl,
  ...(name ? { name } : {}),
  ...(extensions?.length ? { extensions } : {}),
  ...(includeTests ? { includeTests: true } : {}),
  ...(includeReadme ? { includeReadme: true } : {}),
  onProgress: logProgress,
});

console.log(`\ndata: ${li.dataDir}`);
console.log(`source: ${result.slug} (${result.sourceId})`);
console.log(
  `${result.fileCount} files · ${result.chunkCount} chunks · ${Math.round((Date.now() - started) / 1000)}s`,
);
if (result.commitSha) {
  console.log(`commit: ${result.commitSha.slice(0, 12)}`);
}
