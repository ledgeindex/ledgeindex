"use client";

import { useEffect, useRef, useState } from "react";
import { Container } from "@/components/ui/container";
import { SectionBadge } from "@/components/ui/section-badge";
import {
  FADED_TOP,
  FADED_WALL,
  GRADIENT_PLATE_PROPS,
  PLATE_TOP,
  PLATE_WALL,
  Plate,
} from "@/components/home/iso-plate";
import { cn } from "@/lib/utils";

const CYCLE_MS = 4200;

type UseCase = {
  id: string;
  num: string;
  headline: string;
  detail: string;
  plateLabel: string;
  /** Corner of the isometric board this use case's satellite plate sits on. */
  corner: "nw" | "ne" | "se" | "sw";
  comingSoon?: boolean;
};

const USE_CASES: UseCase[] = [
  {
    id: "support",
    num: "01",
    headline: "Fewer tickets for questions docs already answer",
    detail:
      "When someone asks something covered in your docs, they get the answer right away. Your team only sees the hard ones.",
    plateLabel: "SUPPORT",
    corner: "ne",
  },
  {
    id: "onboard",
    num: "02",
    headline: "Help people get unstuck faster",
    detail:
      "New users find the right setup step or guide without waiting on a reply or digging through ten tabs.",
    plateLabel: "ONBOARD",
    corner: "nw",
  },
  {
    id: "docs-gaps",
    num: "03",
    headline: "See what your docs leave out",
    detail:
      "You see the questions people ask that your pages cannot answer yet, so you know what to write next.",
    plateLabel: "GAPS",
    corner: "sw",
    comingSoon: true,
  },
  {
    id: "agents",
    num: "04",
    headline: "Give AI tools real product knowledge",
    detail:
      "Your assistants and tools can look things up in your docs before they answer, instead of making something up.",
    plateLabel: "AGENTS",
    corner: "se",
  },
];

export function UseCaseFocusSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  useEffect(() => {
    if (paused || reducedMotionRef.current) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % USE_CASES.length);
    }, CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, paused]);

  const active = USE_CASES[activeIndex];

  return (
    <section
      id="use-cases"
      aria-label="Use cases"
      className="relative overflow-hidden border-b border-border/60 py-12 sm:py-16"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div aria-hidden className="section-glow-warm pointer-events-none absolute inset-0" />

      <Container className="relative">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-6">
          {/* left: header + compact selector list */}
          <div>
            <SectionBadge>Use cases</SectionBadge>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-[2.125rem]">
              One docs index.
              <span className="text-muted"> Four ways it helps.</span>
            </h2>

            <div className="mt-6 space-y-1.5">
              {USE_CASES.map((useCase, index) => {
                const isActive = index === activeIndex;
                return (
                  <button
                    key={useCase.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    aria-pressed={isActive}
                    className={cn(
                      "flex w-full items-baseline gap-3 rounded-xl border px-4 py-3 text-left transition-[color,background-color,border-color,box-shadow] duration-300",
                      isActive
                        ? "border-border bg-card-solid shadow-card"
                        : "border-transparent hover:bg-surface-raised/60",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 font-mono text-xs font-semibold tracking-[0.08em]",
                        isActive ? "text-accent" : "text-muted/50",
                      )}
                    >
                      {useCase.num}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={cn(
                            "text-sm font-semibold sm:text-[0.9375rem]",
                            isActive ? "text-foreground" : "text-muted-strong",
                          )}
                        >
                          {useCase.headline}
                        </span>
                        {useCase.comingSoon ? (
                          <span className="rounded-full border border-border/70 bg-surface-raised px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase">
                            Coming soon
                          </span>
                        ) : null}
                      </span>
                      {/* Always in flow so switching active item never changes list height */}
                      <span
                        className={cn(
                          "mt-0.5 block text-xs leading-5 text-muted transition-opacity duration-300 sm:text-[0.8125rem]",
                          isActive ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden={!isActive}
                      >
                        {useCase.detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-5 pl-4 font-mono text-[0.625rem] tracking-[0.14em] text-muted uppercase">
              Same knowledge · cloud or your own machines
            </p>
          </div>

          {/* right: isometric board — satellites orbit one index */}
          <IsoUseCaseBoard active={active} />
        </div>
      </Container>
    </section>
  );
}

/* ── Isometric board: central IDX plate + four satellite plates ── */

const CORNER_POSITIONS: Record<UseCase["corner"], string> = {
  nw: "-top-14 -left-14 sm:-top-16 sm:-left-16",
  ne: "-top-14 -right-14 sm:-top-16 sm:-right-16",
  se: "-bottom-14 -right-14 sm:-bottom-16 sm:-right-16",
  sw: "-bottom-14 -left-14 sm:-bottom-16 sm:-left-16",
};

/** Beam angle from board center toward each corner (plane coordinates). */
const CORNER_ANGLES: Record<UseCase["corner"], number> = {
  nw: -135,
  ne: -45,
  se: 45,
  sw: 135,
};

function IsoUseCaseBoard({ active }: { active: UseCase }) {
  return (
    <div
      aria-hidden
      className="mx-auto flex h-72 w-full max-w-sm items-center justify-center sm:h-[23rem] [perspective:1600px]"
    >
      <div className="relative size-40 sm:size-48 [transform-style:preserve-3d] [transform:rotateX(58deg)_rotateZ(-45deg)]">
        {/* ground shadow */}
        <span
          aria-hidden
          className="absolute -inset-6 rounded-[2rem] bg-black/15 blur-2xl dark:bg-black/40"
          style={{ transform: "translateZ(-90px)" }}
        />

        {/* connector beams to each corner */}
        {USE_CASES.map((useCase) => {
          const isActive = useCase.id === active.id;
          return (
            <span
              key={`beam-${useCase.id}`}
              className="absolute top-1/2 left-1/2 h-[2px] w-32 origin-left transition-opacity duration-500 sm:w-36"
              style={{
                transform: `rotate(${CORNER_ANGLES[useCase.corner]}deg) translateZ(2px)`,
                opacity: isActive ? 1 : 0.25,
              }}
            >
              <span
                className={cn(
                  "block h-full w-full rounded-full",
                  isActive
                    ? "bg-gradient-to-r from-amber-600/80 via-slate-400 to-transparent"
                    : "bg-border",
                )}
              />
            </span>
          );
        })}

        {/* faded base plates */}
        <Plate
          z={-64}
          thickness={12}
          grow={14}
          topClassName={FADED_TOP}
          wallClassName={FADED_WALL}
          floatDelay="1.2s"
        />
        <Plate
          z={-32}
          thickness={10}
          grow={7}
          topClassName={FADED_TOP}
          wallClassName={FADED_WALL}
          floatDelay="0.8s"
        />

        {/* gradient rim */}
        <Plate z={4} thickness={10} grow={4} floatDelay="0.4s" {...GRADIENT_PLATE_PROPS} />

        {/* central index plate */}
        <Plate
          z={48}
          thickness={16}
          topClassName={cn(PLATE_TOP, "overflow-hidden shadow-lg")}
          wallClassName={PLATE_WALL}
          floatDelay="0s"
        >
          <div className="flex h-full flex-col items-center justify-center gap-1.5">
            <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-raised font-mono text-[0.625rem] font-bold tracking-[0.08em] text-foreground sm:size-11">
              IDX
            </span>
            <span
              key={active.id}
              className="showcase-fade-rise font-mono text-[0.5rem] font-semibold tracking-[0.14em] text-accent uppercase"
            >
              {active.plateLabel}
            </span>
          </div>
        </Plate>

        {/* satellite plates — active one lifts and goes gradient */}
        {USE_CASES.map((useCase) => {
          const isActive = useCase.id === active.id;
          return (
            <div
              key={useCase.id}
              className={cn(
                "absolute size-[4.25rem] sm:size-20 [transform-style:preserve-3d]",
                CORNER_POSITIONS[useCase.corner],
              )}
            >
              <Plate
                z={isActive ? 104 : 30}
                thickness={isActive ? 12 : 8}
                floatDelay={isActive ? "0.15s" : "0.9s"}
                {...(isActive
                  ? GRADIENT_PLATE_PROPS
                  : { topClassName: PLATE_TOP, wallClassName: PLATE_WALL })}
              >
                <span
                  className={cn(
                    "flex h-full items-center justify-center font-mono text-[0.5rem] font-bold tracking-[0.12em] uppercase transition-colors duration-500 sm:text-[0.5625rem]",
                    isActive ? "text-white" : "text-muted",
                  )}
                >
                  {useCase.plateLabel}
                </span>
              </Plate>
            </div>
          );
        })}
      </div>
    </div>
  );
}
