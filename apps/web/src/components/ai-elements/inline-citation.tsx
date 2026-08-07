"use client";

import { cn } from "@/lib/utils";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type InlineCitationProps = ComponentProps<"span">;

export function InlineCitation({
  className,
  ...props
}: InlineCitationProps) {
  return (
    <span
      className={cn("group/citation relative inline items-center gap-1", className)}
      {...props}
    />
  );
}

export type InlineCitationTextProps = ComponentProps<"span">;

export function InlineCitationText({
  className,
  ...props
}: InlineCitationTextProps) {
  return (
    <span
      className={cn(
        "rounded-sm transition-colors group-hover/citation:bg-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

export type InlineCitationCardProps = ComponentProps<"span">;

export function InlineCitationCard({
  className,
  ...props
}: InlineCitationCardProps) {
  return <span className={cn("relative inline-flex", className)} {...props} />;
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type InlineCitationCardTriggerProps = ComponentProps<"button"> & {
  sources: string[];
};

export function InlineCitationCardTrigger({
  sources,
  className,
  ...props
}: InlineCitationCardTriggerProps) {
  const label = sources[0] ? hostnameLabel(sources[0]) : "source";
  const extra = sources.length > 1 ? ` +${sources.length - 1}` : "";

  return (
    <button
      type="button"
      className={cn(
        "ml-1 inline-flex translate-y-[-0.05em] items-center rounded-full border border-border bg-surface-raised px-1.5 py-0.5 align-middle font-mono text-[0.625rem] font-medium text-muted-strong transition-colors",
        "hover:border-foreground/20 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className,
      )}
      aria-label={`Citation: ${label}${extra}`}
      {...props}
    >
      {label}
      {extra}
    </button>
  );
}

export type InlineCitationCardBodyProps = ComponentProps<"div">;

export function InlineCitationCardBody({
  className,
  ...props
}: InlineCitationCardBodyProps) {
  return (
    <div
      className={cn(
        "pointer-events-none invisible absolute top-[calc(100%+0.4rem)] left-0 z-50 w-80 origin-top-left scale-95 rounded-lg border border-border bg-card-solid p-0 opacity-0 shadow-card transition",
        "group-hover/citation:pointer-events-auto group-hover/citation:visible group-hover/citation:scale-100 group-hover/citation:opacity-100",
        "group-focus-within/citation:pointer-events-auto group-focus-within/citation:visible group-focus-within/citation:scale-100 group-focus-within/citation:opacity-100",
        className,
      )}
      role="tooltip"
      {...props}
    />
  );
}

type CarouselContextValue = {
  index: number;
  count: number;
  setCount: (count: number) => void;
  prev: () => void;
  next: () => void;
};

const CarouselContext = createContext<CarouselContextValue | null>(null);

function useCarousel() {
  const ctx = useContext(CarouselContext);
  if (!ctx) {
    throw new Error("Inline citation carousel controls require InlineCitationCarousel");
  }
  return ctx;
}

export type InlineCitationCarouselProps = ComponentProps<"div">;

export function InlineCitationCarousel({
  className,
  children,
  ...props
}: InlineCitationCarouselProps) {
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(1);

  const prev = useCallback(() => {
    setIndex((current) => (current <= 0 ? Math.max(count - 1, 0) : current - 1));
  }, [count]);

  const next = useCallback(() => {
    setIndex((current) => (current >= count - 1 ? 0 : current + 1));
  }, [count]);

  const value = useMemo(
    () => ({ index, count, setCount, prev, next }),
    [index, count, prev, next],
  );

  return (
    <CarouselContext.Provider value={value}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

export type InlineCitationCarouselContentProps = ComponentProps<"div">;

export function InlineCitationCarouselContent({
  className,
  children,
  ...props
}: InlineCitationCarouselContentProps) {
  const { index, setCount } = useCarousel();
  const items = Array.isArray(children) ? children : [children];

  useEffect(() => {
    setCount(Math.max(items.length, 1));
  }, [items.length, setCount]);

  return (
    <div className={cn("relative overflow-hidden", className)} {...props}>
      {items.map((child, i) => (
        <div
          key={i}
          className={cn(i === index ? "block" : "hidden")}
          aria-hidden={i !== index}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export type InlineCitationCarouselItemProps = ComponentProps<"div">;

export function InlineCitationCarouselItem({
  className,
  ...props
}: InlineCitationCarouselItemProps) {
  return <div className={cn("w-full space-y-2 p-4", className)} {...props} />;
}

export type InlineCitationCarouselHeaderProps = ComponentProps<"div">;

export function InlineCitationCarouselHeader({
  className,
  ...props
}: InlineCitationCarouselHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-t-lg border-b border-border bg-surface-raised px-2 py-1.5",
        className,
      )}
      {...props}
    />
  );
}

export type InlineCitationCarouselIndexProps = ComponentProps<"div">;

export function InlineCitationCarouselIndex({
  children,
  className,
  ...props
}: InlineCitationCarouselIndexProps) {
  const { index, count } = useCarousel();
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-end px-2 py-0.5 text-[0.6875rem] text-muted",
        className,
      )}
      {...props}
    >
      {children ?? `${index + 1}/${count}`}
    </div>
  );
}

export type InlineCitationCarouselPrevProps = ComponentProps<"button">;

export function InlineCitationCarouselPrev({
  className,
  ...props
}: InlineCitationCarouselPrevProps) {
  const { prev, count } = useCarousel();
  if (count <= 1) return null;
  return (
    <button
      type="button"
      aria-label="Previous citation"
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground",
        className,
      )}
      onClick={prev}
      {...props}
    >
      <ArrowLeftIcon className="size-3.5" />
    </button>
  );
}

export type InlineCitationCarouselNextProps = ComponentProps<"button">;

export function InlineCitationCarouselNext({
  className,
  ...props
}: InlineCitationCarouselNextProps) {
  const { next, count } = useCarousel();
  if (count <= 1) return null;
  return (
    <button
      type="button"
      aria-label="Next citation"
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground",
        className,
      )}
      onClick={next}
      {...props}
    >
      <ArrowRightIcon className="size-3.5" />
    </button>
  );
}

export type InlineCitationSourceProps = ComponentProps<"div"> & {
  title?: string;
  url?: string;
  description?: string;
};

export function InlineCitationSource({
  title,
  url,
  description,
  className,
  children,
  ...props
}: InlineCitationSourceProps) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      {title ? (
        <h4 className="truncate text-sm font-medium leading-tight text-foreground">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </h4>
      ) : null}
      {url ? (
        <p className="truncate break-all font-mono text-[0.625rem] text-muted">
          {url}
        </p>
      ) : null}
      {description ? (
        <p className="line-clamp-3 text-sm leading-relaxed text-muted">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export type InlineCitationQuoteProps = ComponentProps<"blockquote">;

export function InlineCitationQuote({
  children,
  className,
  ...props
}: InlineCitationQuoteProps) {
  return (
    <blockquote
      className={cn(
        "border-l-2 border-border pl-3 text-sm italic text-muted",
        className,
      )}
      {...props}
    >
      {children}
    </blockquote>
  );
}
