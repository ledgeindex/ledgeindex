import { cn } from "@/lib/utils";

type HeroAnnouncementStripProps = {
  href?: string;
  className?: string;
};

export function HeroAnnouncementStrip({
  href = "#open-source",
  className,
}: HeroAnnouncementStripProps) {
  return (
    <a
      href={href}
      className={cn(
        "group relative z-10 flex w-full items-center justify-center",
        "border-b border-border bg-card-solid px-4 py-2.5",
        "transition-colors hover:bg-card-raised",
        className,
      )}
    >
      <span className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
        <span className="inline-flex shrink-0 items-center rounded-sm bg-accent px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-background uppercase">
          Open source
        </span>
        <span className="font-mono text-[0.625rem] font-medium tracking-[0.06em] text-muted-strong uppercase sm:text-xs sm:tracking-[0.08em]">
          <span className="normal-case tracking-normal text-foreground">
            @ledgeindex/server
          </span>
          <span className="mx-1.5 hidden text-muted sm:mx-2 sm:inline">|</span>
          <span className="hidden sm:inline">
            Run the same product on your own machines
          </span>
          <span
            aria-hidden
            className="ml-1.5 inline-block transition-transform group-hover:translate-x-0.5 sm:ml-2"
          >
            →
          </span>
        </span>
      </span>
    </a>
  );
}
