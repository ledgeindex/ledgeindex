"use client";

import { useEffect } from "react";
import {
  AppErrorActions,
  AppErrorFallback,
} from "@/components/app-error-fallback";

/**
 * Next.js App Router error UI for the authenticated shell.
 * Desktop (Vite) uses AppErrorBoundary instead — this file is web-only.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/(app)/error]", error);
  }, [error]);

  return (
    <AppErrorFallback
      description="This page crashed while rendering. You can retry or go back to Sources."
      errorMessage={error.message || String(error)}
      actions={
        <AppErrorActions
          onRetry={reset}
          onSecondary={() => {
            window.location.href = "/dashboard";
          }}
          secondaryLabel="Sources"
        />
      }
    />
  );
}
