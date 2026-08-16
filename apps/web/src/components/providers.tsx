"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { PlanBillingProvider } from "@/contexts/plan-billing-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PlanBillingProvider>{children}</PlanBillingProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
