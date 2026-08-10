import { Button } from "@/components/ui/button";
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
import { DesktopDownloadButtons } from "@/components/home/desktop-download-buttons";
import { type DesktopReleaseAsset } from "@/lib/desktop-release";
import { cn } from "@/lib/utils";

const CHIPS = ["Windows & Mac", "iOS & Android soon", "Works offline"] as const;

type AppsComingSectionProps = {
  windowsRelease?: DesktopReleaseAsset | null;
  macRelease?: DesktopReleaseAsset | null;
};

export function AppsComingSection({
  windowsRelease = null,
  macRelease = null,
}: AppsComingSectionProps) {
  return (
    <section
      id="apps"
      aria-label="Mobile and desktop apps"
      className="relative overflow-hidden border-b border-border/60 py-12 sm:py-16"
    >
      <div aria-hidden className="section-glow-warm pointer-events-none absolute inset-0" />
      <span aria-hidden className="paper-accent-fade absolute inset-x-0 top-0 h-px" />

      <Container className="relative">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
          <div>
            <SectionBadge>Desktop live · Mobile soon</SectionBadge>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Your docs on your phone and your desk
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted sm:text-base sm:leading-7">
              The desktop app is ready for Windows and Mac: same dashboard, local
              engine, private files stay on your machine. Mobile is next.
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

            <div className="mt-7">
              <DesktopDownloadButtons
                windowsRelease={windowsRelease}
                macRelease={macRelease}
                trailing={
                  <Button
                    href="#open-source"
                    variant="secondary"
                    className="w-full sm:w-auto"
                  >
                    Run it yourself today
                  </Button>
                }
              />
              {windowsRelease || macRelease ? (
                <p className="mt-3 font-mono text-[0.6875rem] text-muted">
                  Latest installer ·{" "}
                  {windowsRelease?.tag ?? macRelease?.tag}
                </p>
              ) : null}
            </div>
          </div>

          <AppsShowcase className="mx-auto w-full max-w-md lg:max-w-none" />
        </div>
      </Container>
    </section>
  );
}

/**
 * Isometric app preview: the desktop window sits on the extruded plate stack
 * from the hero, with the phone board floating in front of it.
 */
export function AppsShowcase({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative flex select-none items-center justify-center [perspective:1800px]",
        className,
      )}
    >
      <div className="relative h-[24rem] w-full max-w-md [transform-style:preserve-3d] [transform:rotateX(14deg)_rotateY(-13deg)_rotateZ(1.5deg)]">
        <span
          aria-hidden
          className="absolute inset-6 rounded-[2rem] bg-black/20 blur-2xl dark:bg-black/50"
          style={{ transform: "translateZ(-90px)" }}
        />

        {/* desktop app board */}
        <div className="absolute top-6 left-0 h-56 w-[86%] [transform-style:preserve-3d]">
          <Plate
            z={-52}
            thickness={12}
            grow={-14}
            topClassName={FADED_TOP}
            wallClassName={FADED_WALL}
            floatDelay="1.1s"
          />
          <Plate z={-24} thickness={10} grow={8} floatDelay="0.7s" {...GRADIENT_PLATE_PROPS} />
          <Plate
            z={14}
            thickness={18}
            topClassName={cn(PLATE_TOP, "overflow-hidden shadow-xl")}
            wallClassName={PLATE_WALL}
            floatDelay="0s"
          >
            <DesktopFace />
          </Plate>
        </div>

        {/* phone board floating in front */}
        <div
          className="absolute right-1 bottom-2 h-[15rem] w-[8.5rem] [transform-style:preserve-3d]"
          style={{ transform: "translateZ(86px)" }}
        >
          <Plate z={-10} thickness={10} grow={7} floatDelay="0.9s" {...GRADIENT_PLATE_PROPS} />
          <Plate
            z={12}
            thickness={14}
            topClassName="overflow-hidden rounded-2xl border border-border bg-card-solid shadow-xl"
            wallClassName="rounded-sm border border-border bg-surface-raised"
            floatDelay="0.35s"
          >
            <PhoneFace />
          </Plate>
        </div>

        {/* floating label */}
        <div
          className="absolute top-0 left-1/2 [transform-style:preserve-3d]"
          style={{ transform: "translateZ(72px)" }}
        >
          <div className="showcase-plate-float" style={{ animationDelay: "0.5s" }}>
            <span className="-translate-x-1/2 inline-block rounded-md border border-border bg-card-solid px-2.5 py-1 font-mono text-[0.5625rem] font-bold tracking-[0.12em] whitespace-nowrap text-foreground uppercase shadow-card">
              [ ONE ACCOUNT · EVERY DEVICE ]
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const DESKTOP_SOURCES = [
  { name: "Internal handbook", active: true },
  { name: "API reference", active: false },
  { name: "Runbooks", active: false },
] as const;

function DesktopFace() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-surface-raised/70 px-3 py-2">
        <span className="flex gap-1">
          <span className="size-1.5 rounded-full bg-amber-600/70" />
          <span className="size-1.5 rounded-full bg-slate-500/70" />
          <span className="size-1.5 rounded-full bg-stone-400/70" />
        </span>
        <span className="ml-1 font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted-strong uppercase">
          LedgeIndex · desktop
        </span>
        <span className="ml-auto rounded border border-border bg-card-solid px-1.5 py-0.5 font-mono text-[0.4375rem] font-bold tracking-[0.08em] text-muted uppercase">
          Local
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[38%] shrink-0 space-y-1 border-r border-border/70 bg-surface-alt/50 p-2">
          <p className="mb-1 font-mono text-[0.4375rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Your sources
          </p>
          {DESKTOP_SOURCES.map((source) => (
            <div
              key={source.name}
              className={cn(
                "flex items-center gap-1.5 rounded border px-1.5 py-1",
                source.active
                  ? "border-border bg-card-solid shadow-card"
                  : "border-transparent",
              )}
            >
              <span
                className={cn(
                  "size-1 shrink-0 rounded-full",
                  source.active ? "bg-amber-600/80" : "bg-border",
                )}
              />
              <span
                className={cn(
                  "truncate text-[0.5625rem] leading-3.5",
                  source.active ? "font-medium text-foreground" : "text-muted",
                )}
              >
                {source.name}
              </span>
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5 p-2.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 py-1.5">
            <span className="size-1.5 rounded-full border border-border" />
            <span className="truncate text-[0.5625rem] text-muted">
              How do I rotate a key?
            </span>
          </div>
          <div className="space-y-1 rounded-md border border-border bg-card-raised p-2 shadow-card">
            <span className="block h-1 w-full rounded-full bg-border/70" />
            <span className="block h-1 w-[86%] rounded-full bg-border/70" />
            <span className="block h-1 w-[62%] rounded-full bg-border/70" />
            <span className="mt-1.5 block border-l-2 border-amber-600/50 pl-1.5 font-mono text-[0.4375rem] leading-3 text-muted">
              handbook / security / keys
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-surface-alt/60 px-2 py-1.5">
            <span className="font-mono text-[0.4375rem] tracking-[0.08em] text-muted uppercase">
              Indexed on this Mac
            </span>
            <span className="font-mono text-[0.4375rem] font-semibold text-muted-strong">
              1.2k pages
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneFace() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-center border-b border-border/70 bg-surface-raised/70 py-1.5">
        <span className="h-1 w-8 rounded-full bg-border" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <div className="flex items-center gap-1.5">
          <span className="flex size-3.5 items-center justify-center rounded border border-border bg-surface-raised font-mono text-[0.375rem] font-bold text-foreground">
            IDX
          </span>
          <span className="font-mono text-[0.4375rem] font-semibold tracking-[0.1em] text-muted-strong uppercase">
            Ask your docs
          </span>
        </div>

        <div className="flex justify-end">
          <p className="max-w-[88%] rounded-md rounded-br-sm border border-border bg-surface-raised px-1.5 py-1 text-[0.5rem] leading-3 text-foreground">
            Webhook retry limit?
          </p>
        </div>

        <div className="rounded-md rounded-bl-sm border border-border bg-card-raised px-1.5 py-1 shadow-card">
          <span className="block h-[3px] w-full rounded-full bg-border/70" />
          <span className="mt-1 block h-[3px] w-[78%] rounded-full bg-border/70" />
          <span className="mt-1.5 flex items-center gap-1">
            <span className="flex size-2.5 items-center justify-center rounded-[2px] border border-border bg-surface-raised font-mono text-[0.3125rem] font-bold text-muted-strong">
              1
            </span>
            <span className="truncate font-mono text-[0.375rem] text-muted">
              api / webhooks
            </span>
          </span>
        </div>

        <div className="mt-auto flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-1">
          <span className="text-[0.4375rem] text-muted">Ask anything…</span>
          <span className="ml-auto size-2.5 rounded-full bg-gradient-to-br from-amber-600/80 to-slate-500" />
        </div>
      </div>
    </div>
  );
}
