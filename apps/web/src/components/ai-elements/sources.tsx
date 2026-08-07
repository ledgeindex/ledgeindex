"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type SourcesProps = ComponentProps<"div">;

export function Sources({ className, children, ...props }: SourcesProps) {
  return (
    <div
      className={cn("not-prose text-xs text-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export type SourcesTriggerProps = ComponentProps<"summary"> & {
  count: number;
};

export function SourcesTrigger({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) {
  return (
    <summary
      className={cn(
        "flex cursor-pointer list-none items-center gap-2 text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <p className="font-medium">Used {count} sources</p>
          <span
            className="text-[0.625rem] transition-transform group-open:rotate-180"
            aria-hidden
          >
            ▾
          </span>
        </>
      )}
    </summary>
  );
}

export type SourcesContentProps = ComponentProps<"div">;

export function SourcesContent({
  className,
  children,
  ...props
}: SourcesContentProps) {
  return (
    <div className={cn("mt-2 flex flex-col gap-2 pl-1", className)} {...props}>
      {children}
    </div>
  );
}

export type SourceProps = ComponentProps<"a"> & {
  title?: string;
};

export function Source({
  href,
  title,
  children,
  className,
  ...props
}: SourceProps) {
  return (
    <a
      href={href}
      rel="noreferrer"
      target="_blank"
      className={cn(
        "block truncate font-mono text-[0.625rem] text-accent hover:underline",
        className,
      )}
      {...props}
    >
      {children ?? title ?? href}
    </a>
  );
}
