import { cn } from "@/lib/utils";

/* ── Pre-indexed registry: JS & TypeScript OSS docs, ready to attach ── */

type RegistryEntry = {
  name: string;
  version: string;
  chunks: string;
  freshness: string;
  glyphClass: string;
};

const GLYPHS = [
  "bg-gradient-to-br from-amber-700 to-slate-500",
  "bg-gradient-to-br from-slate-500 to-stone-500",
  "bg-gradient-to-br from-stone-400 to-amber-700/80",
  "bg-gradient-to-br from-amber-600 to-stone-600",
  "bg-gradient-to-br from-slate-400 to-amber-700/70",
  "bg-gradient-to-br from-stone-500 to-slate-600",
] as const;

function entry(
  name: string,
  version: string,
  chunks: string,
  freshness: string,
  glyphIndex: number,
): RegistryEntry {
  return { name, version, chunks, freshness, glyphClass: GLYPHS[glyphIndex % GLYPHS.length] };
}

const ROW_ONE: RegistryEntry[] = [
  entry("React", "v19", "12.4k chunks", "2h", 0),
  entry("Next.js", "v15", "18.1k chunks", "3h", 1),
  entry("TypeScript", "v5.8", "15.6k chunks", "2h", 2),
  entry("Node.js", "v22", "28.3k chunks", "4h", 3),
  entry("Vite", "v6", "8.7k chunks", "3h", 4),
  entry("Tailwind CSS", "v4", "6.3k chunks", "5h", 5),
  entry("Prisma", "v6", "7.2k chunks", "4h", 0),
  entry("Zod", "v4", "4.1k chunks", "2h", 1),
];

const ROW_TWO: RegistryEntry[] = [
  entry("Vue", "v3", "11.8k chunks", "3h", 2),
  entry("NestJS", "v11", "14.2k chunks", "5h", 3),
  entry("tRPC", "v11", "5.4k chunks", "2h", 4),
  entry("Vitest", "v3", "6.9k chunks", "4h", 5),
  entry("Express", "v5", "9.1k chunks", "6h", 0),
  entry("TanStack Query", "v5", "7.8k chunks", "3h", 1),
  entry("Drizzle", "v0.40", "5.6k chunks", "2h", 2),
  entry("Hono", "v4", "4.8k chunks", "4h", 3),
];

export function RegistrySection() {
  return (
    <section
      id="registry"
      aria-label="Pre-indexed registry"
      className="relative overflow-hidden border-b border-border/60 py-10 sm:py-12"
    >
      <div aria-hidden className="section-glow-cool pointer-events-none absolute inset-0" />

      {/* counter-scrolling card rails — full-bleed */}
      <div className="relative space-y-3">
        <RegistryRail entries={ROW_ONE} durationSec={56} />
        <RegistryRail entries={ROW_TWO} durationSec={64} reverse />
      </div>
    </section>
  );
}

function RegistryRail({
  entries,
  durationSec,
  reverse = false,
}: {
  entries: RegistryEntry[];
  durationSec: number;
  reverse?: boolean;
}) {
  const items = [...entries, ...entries];
  return (
    <div className="proof-marquee-mask">
      <div
        className={cn(
          "proof-marquee-track flex w-max gap-3",
          reverse && "[animation-direction:reverse]",
        )}
        style={{ animationDuration: `${durationSec}s` }}
      >
        {items.map((item, index) => (
          <RegistryCard key={`${item.name}-${index}`} entry={item} />
        ))}
      </div>
    </div>
  );
}

function RegistryCard({ entry }: { entry: RegistryEntry }) {
  return (
    <div className="group flex w-60 shrink-0 items-center gap-3 rounded-xl border border-border bg-card-solid px-3.5 py-3 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold text-white shadow-sm",
          entry.glyphClass,
        )}
      >
        {entry.name.slice(0, 1)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <p className="truncate text-sm font-semibold text-foreground">
            {entry.name}
          </p>
          <span className="shrink-0 font-mono text-[0.5625rem] font-semibold text-muted">
            {entry.version}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[0.5625rem] tracking-wide text-muted">
          {entry.chunks}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1 font-mono text-[0.5rem] tracking-wide text-muted uppercase">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-gradient-to-br from-amber-600 to-slate-500"
          />
          {entry.freshness}
        </span>
        <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted-strong uppercase opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          attach +
        </span>
      </div>
    </div>
  );
}
