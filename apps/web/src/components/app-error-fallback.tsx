"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type AppErrorFallbackProps = {
  title?: string;
  description: string;
  errorMessage?: string;
  actions: ReactNode;
};

/**
 * Shared crash UI for Next `error.tsx` and the desktop ErrorBoundary.
 */
export function AppErrorFallback({
  title = "Something broke",
  description,
  errorMessage,
  actions,
}: AppErrorFallbackProps) {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center bg-surface-alt px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card-solid p-6 shadow-card">
        <div className="mb-5 flex justify-center">
          <img
            src="/images/error-illustration.webp"
            alt=""
            width={252}
            height={291}
            className="h-auto w-[11.5rem] select-none sm:w-[13rem]"
            draggable={false}
          />
        </div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted">{description}</p>
        {errorMessage ? (
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-[0.6875rem] leading-5 text-muted whitespace-pre-wrap">
            {errorMessage}
          </pre>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">{actions}</div>
      </div>
    </div>
  );
}

export function AppErrorActions({
  onRetry,
  onSecondary,
  secondaryLabel,
}: {
  onRetry: () => void;
  onSecondary: () => void;
  secondaryLabel: string;
}) {
  return (
    <>
      <Button className="w-full sm:flex-1" onClick={onRetry}>
        Try again
      </Button>
      <Button
        variant="secondary"
        className="w-full sm:flex-1"
        onClick={onSecondary}
      >
        {secondaryLabel}
      </Button>
    </>
  );
}
