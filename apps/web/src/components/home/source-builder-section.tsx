import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/* ── Source builder: author a source by hand when there is no site to
     crawl — pages, markdown and code pins, versions, then index. ── */

const CHIPS = ["Markdown", "Code blocks", "Categories", "Versions"] as const;

export function SourceBuilderSection() {
  return (
    <section
      id="source-builder"
      aria-label="Source builder"
      className="relative overflow-hidden border-b border-border/60 py-12 sm:py-16"
    >
      <div
        aria-hidden
        className="section-glow-warm pointer-events-none absolute inset-0"
      />

      <Container className="relative">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              No docs site? Write it yourself.
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted sm:text-base sm:leading-7">
              Draft the pages that matter, add code samples, and group them how
              you like. Save a version, index it, and people can ask questions
              the same way they would with a crawled site. Same links back to
              the source.
            </p>

            <div className="mt-5 flex flex-wrap gap-1.5">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-md border border-border bg-surface-raised px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase"
                >
                  {chip}
                </span>
              ))}
            </div>

            <p className="mt-5 overflow-x-auto rounded-xl border border-border bg-card-solid px-3 py-2.5 font-mono text-[0.6875rem] leading-5 text-muted shadow-card sm:px-4 sm:text-xs">
              <span className="text-muted/70">$</span>{" "}
              <span className="text-foreground">
                builder → 12 pages · v2 → indexed 348 chunks
              </span>
            </p>
          </div>

          <BuilderWorkbench />
        </div>
      </Container>
    </section>
  );
}

/* ── Visual: the builder workbench — structure tree on the left, the
     page you are writing on the right, with an empty pin slot. ── */

type TreeNode = {
  label: string;
  depth: 0 | 1 | 2;
  kind: "category" | "subcategory" | "page";
  active?: boolean;
};

const TREE: TreeNode[] = [
  { label: "Guides", depth: 0, kind: "category" },
  { label: "Auth", depth: 1, kind: "subcategory" },
  { label: "Rotate API keys", depth: 2, kind: "page", active: true },
  { label: "Scopes", depth: 2, kind: "page" },
  { label: "API", depth: 0, kind: "category" },
  { label: "Tokens", depth: 1, kind: "subcategory" },
];

const DEPTH_PADDING: Record<TreeNode["depth"], string> = {
  0: "pl-2",
  1: "pl-4",
  2: "pl-7",
};

export function BuilderWorkbench() {
  return (
    <div aria-hidden className="relative">
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-card">
        {/* chrome: file name + version + actions */}
        <div className="flex items-center gap-2 border-b border-border/70 bg-surface-raised/70 px-3 py-2">
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="ml-1.5 truncate font-mono text-[0.5625rem] tracking-[0.1em] text-muted uppercase">
            Internal API guide
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className="rounded-md border border-border bg-card-solid px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted-strong uppercase">
              v2 ▾
            </span>
            <span className="rounded-md border border-border bg-card-solid px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted-strong uppercase">
              Save
            </span>
            <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-background uppercase">
              Index
            </span>
          </span>
        </div>

        <div className="flex min-h-[15rem]">
          {/* structure tree */}
          <div className="w-[36%] shrink-0 border-r border-border/70 bg-surface-alt/40 py-2 sm:w-[34%]">
            <p className="px-2 pb-1.5 font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
              Structure
            </p>
            <ul className="space-y-px">
              {TREE.map((node) => (
                <li
                  key={`${node.depth}-${node.label}`}
                  className={cn(
                    "flex items-center gap-1.5 py-1 pr-2 text-[0.625rem] sm:text-[0.6875rem]",
                    DEPTH_PADDING[node.depth],
                    node.active
                      ? "bg-card-solid font-medium text-foreground shadow-sm"
                      : "text-muted",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[0.5rem]",
                      node.kind === "page" ? "text-muted/70" : "text-muted",
                    )}
                  >
                    {node.kind === "page" ? "▤" : "▾"}
                  </span>
                  <span className="truncate">{node.label}</span>
                </li>
              ))}
            </ul>
            <span className="mt-2 ml-2 inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-[0.5rem] tracking-[0.08em] text-muted uppercase">
              + Page
            </span>
          </div>

          {/* page canvas */}
          <div className="min-w-0 flex-1 space-y-2 bg-surface-alt/20 p-3">
            <p className="truncate text-xs font-semibold text-foreground sm:text-sm">
              Rotate API keys
            </p>

            {/* markdown pin */}
            <div className="overflow-hidden rounded-lg border border-border bg-card-solid">
              <div className="flex items-center gap-1.5 border-b border-border/60 bg-surface-raised/70 px-2 py-1">
                <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                  Markdown
                </span>
              </div>
              <div className="space-y-1.5 p-2">
                <span className="block h-1.5 w-4/5 rounded-full bg-border" />
                <span className="block h-1.5 w-full rounded-full bg-border/70" />
                <span className="block h-1.5 w-3/5 rounded-full bg-border/70" />
              </div>
            </div>

            {/* code pin */}
            <div className="overflow-hidden rounded-lg border border-border bg-card-solid">
              <div className="flex items-center gap-1.5 border-b border-border/60 bg-surface-raised/70 px-2 py-1">
                <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                  Code
                </span>
                <span className="rounded border border-border px-1 font-mono text-[0.4375rem] tracking-[0.08em] text-muted-strong uppercase">
                  ts
                </span>
              </div>
              <div className="space-y-1 bg-surface-alt/50 p-2 font-mono">
                <span className="flex items-center gap-1">
                  <span className="block h-1.5 w-8 rounded-full bg-amber-600/70" />
                  <span className="block h-1.5 w-14 rounded-full bg-border" />
                </span>
                <span className="flex items-center gap-1 pl-3">
                  <span className="block h-1.5 w-10 rounded-full bg-slate-500/60" />
                  <span className="block h-1.5 w-16 rounded-full bg-border/70" />
                </span>
                <span className="block h-1.5 w-12 rounded-full bg-border/70" />
              </div>
            </div>

            {/* empty slot — the next pin snaps in here */}
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border/80 py-2.5">
              <span className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
                + Add pin
              </span>
            </div>
          </div>
        </div>

        {/* footer: what indexing produced */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/70 bg-surface-raised/50 px-3 py-1.5">
          <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-400">
            Indexed
          </span>
          <span className="font-mono text-[0.5625rem] text-muted">
            12 pages · 348 chunks · citable as builder/internal-api-guide
          </span>
        </div>
      </div>
    </div>
  );
}
