export type SourceUpdatesChangelog = {
  baselineCaptured: boolean;
  unchangedCount: number;
  added: Array<{ url: string; title: string }>;
  updated: Array<{ url: string; title: string }>;
  removed: Array<{ url: string; title: string }>;
};

export type UpdatesProgressUpdate = {
  phase: string;
  status: string;
  current: number;
  total: number;
  activePath?: string;
  pathIndex?: number;
  pathTotal?: number;
};

export function formatUpdatesPhase(update: UpdatesProgressUpdate): string {
  const { phase, current, total, activePath } = update;
  const progress =
    total > 0 ? ` ${current}/${total}` : current > 0 ? ` ${current}` : "";
  const path =
    activePath && update.pathTotal && update.pathTotal > 1
      ? ` (${update.pathIndex}/${update.pathTotal} ${activePath})`
      : activePath
        ? ` (${activePath})`
        : "";

  switch (phase) {
    case "discovering":
      return activePath === "sitemap"
        ? `Reading sitemap${progress}`
        : `Discovering${path}${progress}`;
    case "parsing":
      return activePath === "sitemap"
        ? `Reading sitemap${progress}`
        : `Probing pages (HEAD)${progress}`;
    case "comparing":
      return "Comparing content hashes";
    case "embedding":
      return `Embedding${progress}`;
    case "storing":
      return `Storing chunks${progress}`;
    case "done":
      return update.status === "applying" ? "Applying updates" : "Done";
    default:
      return phase;
  }
}

export function printUpdatesChangelog(
  changelog: SourceUpdatesChangelog,
  options?: { applyHint?: string },
) {
  if (changelog.baselineCaptured) {
    console.log("Baseline captured — future checks will compare against this.");
    return;
  }

  const changeCount =
    changelog.added.length +
    changelog.updated.length +
    changelog.removed.length;

  if (changeCount === 0) {
    console.log(`No changes (${changelog.unchangedCount} pages unchanged).`);
    return;
  }

  console.log(
    `Changes: +${changelog.added.length} added, ~${changelog.updated.length} updated, -${changelog.removed.length} removed (${changelog.unchangedCount} unchanged)`,
  );

  const list = (
    label: string,
    pages: Array<{ url: string; title: string }>,
  ) => {
    if (pages.length === 0) return;
    console.log(`\n${label}:`);
    for (const page of pages.slice(0, 20)) {
      console.log(`  ${page.url}`);
    }
    if (pages.length > 20) {
      console.log(`  … and ${pages.length - 20} more`);
    }
  };

  list("Added", changelog.added);
  list("Updated", changelog.updated);
  list("Removed", changelog.removed);

  if (options?.applyHint) {
    console.log(`\n${options.applyHint}`);
  }
}

export function parseUpdatesMode(
  modeRaw: string | undefined,
): "discover" | "selected" | "probe" | null | undefined {
  if (!modeRaw) return undefined;
  if (modeRaw === "selected") return "selected";
  if (modeRaw === "discover") return "discover";
  if (modeRaw === "probe") return "probe";
  return null;
}

export function createUpdatesProgressReporter(json: boolean) {
  let lastLine = "";
  return {
    writeCheckStart(name: string, mode: string) {
      if (!json) {
        process.stderr.write(`Checking ${name} (${mode})…\n`);
      }
    },
    writeApplyStart(name: string) {
      if (!json) {
        process.stderr.write(`Applying updates to ${name}…\n`);
      }
    },
    onProgress: json
      ? undefined
      : (update: UpdatesProgressUpdate) => {
          const line = formatUpdatesPhase(update);
          if (line === lastLine) return;
          lastLine = line;
          process.stderr.write(`\r${line.padEnd(60)}`);
        },
    finish() {
      if (!json) {
        process.stderr.write("\n");
      }
    },
    fail(json: boolean) {
      if (!json) {
        process.stderr.write("\n");
      }
    },
  };
}
