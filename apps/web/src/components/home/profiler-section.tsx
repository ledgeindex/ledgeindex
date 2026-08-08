import { Container } from "@/components/ui/container";
import { SectionBadge } from "@/components/ui/section-badge";
import { cn } from "@/lib/utils";

const LENSES = [
  { id: "identity", label: "Identity" },
  { id: "docs_identity", label: "About" },
  { id: "capabilities", label: "Capabilities" },
  { id: "pricing", label: "Pricing" },
  { id: "integrations", label: "Integrations" },
  { id: "usage", label: "Usage" },
] as const;

export function ProfilerSection() {
  return (
    <section
      id="profiler"
      aria-label="Site profiler"
      className="relative overflow-hidden border-b border-border/60 py-10 sm:py-14"
    >
      <div aria-hidden className="section-glow-cool pointer-events-none absolute inset-0" />

      <Container className="relative">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
          <div>
            <SectionBadge>Profiler</SectionBadge>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              A clear picture of any product site
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted sm:text-base sm:leading-7">
              Besides indexing docs, LedgeIndex can research a product site and
              pull out who they are, what they offer, pricing, and more. Each
              fact comes with a link you can open.
            </p>

            <div className="mt-5 flex flex-wrap gap-1.5">
              {LENSES.map((lens) => (
                <span
                  key={lens.id}
                  className="rounded-md border border-border bg-surface-raised px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase"
                >
                  {lens.label}
                </span>
              ))}
            </div>

            <p className="mt-5 overflow-x-auto rounded-xl border border-border bg-card-solid px-3 py-2.5 font-mono text-[0.6875rem] leading-5 text-muted shadow-card sm:px-4 sm:text-xs">
              <span className="text-muted/70">$</span>{" "}
              <span className="text-foreground">
                await profileSite(&quot;https://docs.example.com&quot;,
                [&quot;identity&quot;, &quot;capabilities&quot;])
              </span>
            </p>
          </div>

          <div className="relative">
            <ProfileRunPanel />
            <IdentityOutputCard />
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ── Sample identity lens output: what one lens actually returns ── */

function IdentityOutputCard() {
  return (
    <article className="relative z-10 mx-auto -mt-10 w-full max-w-xs overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card sm:absolute sm:right-0 sm:-bottom-2 sm:mx-0 sm:mt-0 lg:-right-2">
      <span
        aria-hidden
        className="paper-accent-bar absolute inset-x-0 top-0 h-0.5"
      />
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2">
        <span className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted-strong uppercase">
          identity · output
        </span>
        <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase">
          cited
        </span>
      </div>
      <dl className="space-y-2 px-3.5 py-3 font-mono text-[0.625rem] leading-relaxed">
        <div>
          <dt className="text-muted">category</dt>
          <dd className="text-foreground">
            &quot;Knowledge infrastructure for AI agents&quot;
          </dd>
        </div>
        <div>
          <dt className="text-muted">oneLiner</dt>
          <dd className="text-foreground">
            &quot;Turns docs into answers people can check&quot;
          </dd>
        </div>
        <div>
          <dt className="text-muted">primaryBuyers</dt>
          <dd className="flex flex-wrap gap-1 pt-0.5">
            {["platform teams", "devrel"].map((buyer) => (
              <span
                key={buyer}
                className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[0.5625rem] text-muted-strong"
              >
                {buyer}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </article>
  );
}

/* ── Profile run panel: one crawl at the top, lens rows extracting
     structured fields below. Flat, no 3D. ──────────────────────── */

type LensRow = {
  id: string;
  label: string;
  status: "done" | "active" | "queued";
  fields: string | null;
};

const LENS_ROWS: LensRow[] = [
  { id: "identity", label: "identity", status: "done", fields: "6 fields" },
  { id: "capabilities", label: "capabilities", status: "active", fields: "picking 12 pages" },
  { id: "pricing", label: "pricing", status: "queued", fields: null },
  { id: "integrations", label: "integrations", status: "queued", fields: null },
];

function ProfileRunPanel() {
  return (
    <div
      aria-hidden
      className="mx-auto w-full max-w-sm pb-24 sm:pb-28 lg:pb-24"
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-card">
        {/* window chrome */}
        <div className="flex items-center gap-1.5 border-b border-border/70 bg-surface-raised/70 px-3.5 py-2">
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="ml-2 font-mono text-[0.5625rem] tracking-[0.1em] text-muted uppercase">
            profile.site
          </span>
        </div>

        {/* the one crawl */}
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised font-mono text-[0.5rem] font-bold tracking-[0.06em] text-foreground">
              WWW
            </span>
            <span className="truncate font-mono text-[0.6875rem] text-foreground">
              docs.example.com
            </span>
          </span>
          <span className="shrink-0 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-400">
            1 crawl · 84 pages
          </span>
        </div>

        {/* lens rows fed by that crawl */}
        <ul>
          {LENS_ROWS.map((lens, index) => (
            <li
              key={lens.id}
              className={cn(
                "relative flex items-center gap-3 px-3.5 py-2.5",
                index > 0 && "border-t border-border/50",
              )}
            >
              {/* feed line from the crawl row */}
              <span className="relative flex w-4 shrink-0 justify-center self-stretch">
                <span className="absolute -top-2.5 bottom-1/2 w-px bg-border" />
                <span
                  className={cn(
                    "absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full",
                    lens.status === "done" && "bg-emerald-500/80",
                    lens.status === "active" && "animate-pulse bg-accent",
                    lens.status === "queued" && "bg-border",
                  )}
                />
              </span>

              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono text-[0.6875rem]",
                  lens.status === "queued" ? "text-muted" : "text-foreground",
                )}
              >
                {lens.label}
              </span>

              {lens.status === "done" ? (
                <span className="shrink-0 font-mono text-[0.5625rem] text-emerald-600 dark:text-emerald-400">
                  ✓ {lens.fields}
                </span>
              ) : lens.status === "active" ? (
                <span className="shrink-0 animate-pulse font-mono text-[0.5625rem] text-accent">
                  {lens.fields}…
                </span>
              ) : (
                <span className="shrink-0 font-mono text-[0.5625rem] text-muted">
                  queued
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
