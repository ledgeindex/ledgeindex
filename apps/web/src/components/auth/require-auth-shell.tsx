"use client";

import type { ReactNode } from "react";
import { RequireAuth } from "@/components/auth/require-auth";

/**
 * Single auth gate for the private app. Mounted once from `app/(app)/layout.tsx`
 * so every route in that group is protected without per-page wiring.
 */
export function RequireAuthShell({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
