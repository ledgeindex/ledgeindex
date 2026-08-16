import type { CrawlProgressUpdate } from "@ledgeindex/sdk";

const PHASE_LABELS: Record<CrawlProgressUpdate["phase"], string> = {
  preflight: "Preflight",
  crawl: "Crawling",
  filter: "Filtering",
  index: "Indexing",
  done: "Done",
  error: "Error",
};

export class PipelineRenderer {
  private lastLine = "";

  update(update: CrawlProgressUpdate) {
    const label = PHASE_LABELS[update.phase];
    let line = `[${label}] ${update.detail}`;

    if (update.crawlProgress) {
      const p = update.crawlProgress;
      if (p.phase === "validating") {
        line = `[Crawling] validating ${p.validatedCount ?? 0}/${p.validationTotal ?? 0} (${p.httpErrorCount ?? 0} errors)`;
      } else {
        line = `[Crawling] discovering ${p.pagesDiscovered}/${p.maxPages} pages`;
      }
    }

    if (line === this.lastLine) return;
    this.lastLine = line;
    process.stderr.write(`\r\x1b[2K${line}`);
  }

  finish(message: string) {
    process.stderr.write(`\r\x1b[2K${message}\n`);
    this.lastLine = "";
  }

  error(message: string) {
    process.stderr.write(`\r\x1b[2K[Error] ${message}\n`);
    this.lastLine = "";
  }
}
