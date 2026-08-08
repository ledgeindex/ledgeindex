import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function SectionBadge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "mb-4 inline-flex items-center rounded-md border border-border bg-card-solid px-3 py-1 shadow-card",
        "font-mono text-[0.6875rem] font-semibold tracking-[0.14em] text-muted uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Eyebrow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[0.6875rem] font-semibold tracking-[0.14em] text-muted uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}
