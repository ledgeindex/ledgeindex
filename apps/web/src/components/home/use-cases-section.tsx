import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

/* ── LlamaIndex-style solution cards: pastel gradient panels, each with
     a distinct hand-built CSS illustration. ─────────────────────────── */

type UseCase = {
  eyebrow: string;
  title: string;
  cta: string;
  href: string;
  cardClassName: string;
  illustration: "ribbon" | "parse" | "arch";
};

const USE_CASES: UseCase[] = [
  {
    eyebrow: "Answers you can check",
    title: "Every reply links back to the page it came from.",
    cta: "See how it works",
    href: "#showcase",
    cardClassName:
      "bg-gradient-to-b from-stone-100 via-amber-50 to-stone-200 dark:from-stone-900/60 dark:via-amber-950/25 dark:to-stone-900/50",
    illustration: "ribbon",
  },
  {
    eyebrow: "Messy docs, clear answers",
    title: "Long, sprawling docs sites turn into answers people can ask for.",
    cta: "See the pipeline",
    href: "#showcase",
    cardClassName:
      "bg-gradient-to-b from-slate-100 via-stone-50 to-amber-50 dark:from-slate-900/50 dark:via-stone-900/40 dark:to-amber-950/20",
    illustration: "parse",
  },
  {
    eyebrow: "Yours to run",
    title: "Run it yourself, or let us host it for you.",
    cta: "Explore open source",
    href: "#open-source",
    cardClassName:
      "bg-gradient-to-b from-amber-50 via-stone-100 to-slate-100 dark:from-amber-950/30 dark:via-stone-900/40 dark:to-slate-900/40",
    illustration: "arch",
  },
];

export function UseCasesSection() {
  return (
    <section
      aria-label="Solutions"
      className="relative overflow-hidden border-b border-border/60 py-10 sm:py-14"
    >
      <Container className="relative">
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
          {USE_CASES.map((useCase) => (
            <article
              key={useCase.eyebrow}
              className={cn(
                "group relative flex min-h-[24rem] flex-col overflow-hidden rounded-3xl border border-border/60 p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg sm:min-h-[27rem] sm:p-7",
                useCase.cardClassName,
              )}
            >
              <p className="text-sm font-medium text-foreground/70">
                {useCase.eyebrow}
              </p>

              <div className="flex flex-1 items-center justify-center py-6">
                {useCase.illustration === "ribbon" ? <ChevronRibbon /> : null}
                {useCase.illustration === "parse" ? <ParseSchematic /> : null}
                {useCase.illustration === "arch" ? <SteppedArch /> : null}
              </div>

              <h3 className="text-xl leading-snug font-semibold tracking-tight text-foreground sm:text-[1.375rem]">
                {useCase.title}
              </h3>

              <div className="mt-5">
                <a
                  href={useCase.href}
                  className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 font-mono text-[0.625rem] font-bold tracking-[0.16em] text-background uppercase transition-opacity hover:opacity-85"
                >
                  {useCase.cta}
                </a>
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ── Illustration 1: folded gradient chevron ribbon ──────────── */

function ChevronRibbon() {
  const SEGMENTS = 7;
  return (
    <div aria-hidden className="flex items-center px-1 py-8">
      {Array.from({ length: SEGMENTS }).map((_, i) => {
        const up = i % 2 === 0;
        const colored = i % 3 !== 1;
        return (
          <div
            key={i}
            className="relative -ml-px h-[4.5rem] w-8 first:ml-0 sm:w-9"
            style={{ transform: `skewY(${up ? -16 : 16}deg)` }}
          >
            {/* extruded side */}
            <span className="absolute inset-x-0 top-2.5 bottom-0 rounded-[3px] border border-foreground/25 bg-white dark:bg-neutral-200" />
            {/* top face */}
            <span
              className={cn(
                "absolute inset-x-0 top-0 h-11 rounded-[3px] border border-foreground/30",
                colored
                  ? "bg-gradient-to-br from-amber-700/80 via-slate-500 to-stone-400"
                  : "bg-white dark:bg-neutral-100",
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ── Illustration 2: document → structured parse schematic ───── */

function ParseSchematic() {
  return (
    <div aria-hidden className="relative h-44 w-full max-w-[15rem]">
      {/* table document */}
      <div className="absolute top-0 right-0 h-40 w-40 rotate-2 rounded-md border border-foreground/40 bg-white p-2 shadow-[5px_7px_0_rgb(0_0_0/0.1)] sm:right-2 dark:bg-neutral-100">
        <div className="mb-1.5 h-2 w-3/5 rounded-xs bg-foreground/60 dark:bg-neutral-700" />
        <div className="grid h-[calc(100%-1rem)] grid-cols-4 grid-rows-5 gap-px overflow-hidden rounded-xs border border-foreground/25 bg-foreground/25 dark:border-neutral-400 dark:bg-neutral-400">
          {Array.from({ length: 20 }).map((_, i) => (
            <span key={i} className="bg-white dark:bg-neutral-100" />
          ))}
        </div>
      </div>

      {/* extracted text snippet */}
      <div className="absolute top-5 left-0 w-28 -rotate-3 space-y-1 rounded-sm border border-foreground/30 bg-white/95 p-2 shadow-sm dark:bg-neutral-100">
        <span className="block h-1 w-full rounded-xs bg-foreground/45 dark:bg-neutral-600" />
        <span className="block h-1 w-5/6 rounded-xs bg-foreground/45 dark:bg-neutral-600" />
        <span className="block h-1 w-full rounded-xs bg-foreground/45 dark:bg-neutral-600" />
        <span className="block h-1 w-2/3 rounded-xs bg-foreground/45 dark:bg-neutral-600" />
      </div>

      {/* extracted chart chip */}
      <div className="absolute bottom-1 left-6 flex h-14 w-24 rotate-1 items-end gap-1 rounded-sm border border-foreground/30 bg-white/95 p-2 shadow-sm dark:bg-neutral-100">
        {[35, 60, 45, 80, 55].map((h, i) => (
          <span
            key={i}
            className="w-2.5 rounded-t-xs bg-gradient-to-t from-slate-500 to-amber-600/80"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Illustration 3: stepped gradient arch ───────────────────── */

function SteppedArch() {
  const HEIGHTS = [44, 70, 96, 122, 148, 164, 148, 122, 96, 70, 44];
  return (
    <div aria-hidden className="flex h-44 items-center justify-center gap-[3px]">
      {HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="w-4 rounded-[2px] bg-gradient-to-b from-neutral-900 via-orange-500 to-amber-200 sm:w-[1.125rem] dark:from-neutral-950 dark:via-orange-600 dark:to-amber-300"
          style={{ height: h }}
        />
      ))}
    </div>
  );
}
