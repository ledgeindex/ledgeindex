"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { RequestAccessGate } from "@/components/auth/request-access-gate";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, hasAppAccess } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const desktop = useLedgeIndexDesktop();
  const homePath = desktop ? "/chat" : "/dashboard";

  useEffect(() => {
    if (!isFirebaseConfigured || loading || user) return;
    const returnPath = pathname?.startsWith("/") ? pathname : homePath;
    router.replace(`/login?returnUrl=${encodeURIComponent(returnPath)}`);
  }, [loading, user, router, pathname, homePath]);

  if (!isFirebaseConfigured) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <p className="max-w-md text-center text-sm text-muted">
          Firebase Auth is not configured. Add{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_FIREBASE_*</code> to{" "}
          <code className="font-mono text-xs">apps/web/.env.local</code>.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <p className="text-sm text-muted">Checking sign-in…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <p className="text-sm text-muted">Redirecting to sign-in…</p>
      </div>
    );
  }

  if (!hasAppAccess) {
    return <RequestAccessGate />;
  }

  return children;
}
