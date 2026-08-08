import Link from "next/link";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

export function SiteBrand({
  href = "/",
  className,
  showWordmark = true,
  subtext,
}: {
  href?: string;
  className?: string;
  showWordmark?: boolean;
  subtext?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("flex shrink-0 items-center gap-2 sm:gap-2.5", className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={publicAssetUrl("/images/logo.webp?v=2")}
        alt="LedgeIndex"
        width={563}
        height={808}
        className="h-7 w-auto shrink-0 sm:h-8"
        decoding="async"
        suppressHydrationWarning
      />
      {showWordmark || subtext ? (
        <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
          {showWordmark ? (
            <span className="truncate font-mono text-[0.6875rem] font-semibold tracking-[0.18em] text-foreground uppercase sm:text-xs sm:tracking-[0.2em]">
              LedgeIndex
            </span>
          ) : null}
          {subtext ? (
            <span className="truncate font-mono text-[0.5625rem] tracking-[0.1em] text-muted uppercase">
              {subtext}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
