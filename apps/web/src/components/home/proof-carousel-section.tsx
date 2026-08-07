"use client";

import { cn } from "@/lib/utils";

type ProofCard = {
  metric: string;
  label: string;
  company: string;
  cta: string;
  href: string;
};

const PROOF_CARDS: ProofCard[] = [
  {
    metric: "99.1%",
    label: "Answers that matched the docs",
    company: "DevTools Co.",
    cta: "See case studies",
    href: "#",
  },
  {
    metric: "+1M",
    label: "Questions answered from real docs",
    company: "Platform Inc.",
    cta: "Read the story",
    href: "#",
  },
  {
    metric: "47ms",
    label: "Typical time to find the right page",
    company: "Infra Labs",
    cta: "See benchmarks",
    href: "#",
  },
  {
    metric: "12min",
    label: "From docs URL to first answers",
    company: "Agent Studio",
    cta: "Read the story",
    href: "#",
  },
  {
    metric: "3.2×",
    label: "Faster than building it in-house",
    company: "SaaS Platform",
    cta: "See case studies",
    href: "#",
  },
];

const MARQUEE_ITEMS = [...PROOF_CARDS, ...PROOF_CARDS];

export function ProofCarouselSection() {
  return (
    <section
      aria-label="Production results"
      className="relative overflow-hidden border-b border-border/60 bg-surface-alt py-5 sm:py-6"
    >
      <div aria-hidden className="section-glow-cool pointer-events-none absolute inset-0" />

      <div className="proof-marquee-mask">
        <div className="proof-marquee-track flex w-max gap-3 sm:gap-4">
          {MARQUEE_ITEMS.map((card, index) => (
            <ProofCardItem
              key={`${card.metric}-${card.company}-${index}`}
              card={card}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProofCardItem({ card }: { card: ProofCard }) {
  return (
    <article
      className={cn(
        "flex w-[15.5rem] shrink-0 flex-col justify-between sm:w-[19rem]",
        "rounded-2xl border border-border bg-card-solid p-5 shadow-card",
      )}
    >
      <div>
        <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {card.metric}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">{card.label}</p>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted-strong uppercase">
          {card.company}
        </span>
        <a
          href={card.href}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2.5 py-1 font-mono text-[0.5625rem] font-medium tracking-[0.06em] text-muted-strong uppercase transition-colors hover:text-foreground"
        >
          {card.cta}
          <span aria-hidden>→</span>
        </a>
      </div>
    </article>
  );
}
