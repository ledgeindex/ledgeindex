"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DesktopTitleBar } from "@/components/desktop/desktop-titlebar";
import { SiteBrand } from "@/components/site-brand";
import { Button } from "@/components/ui/button";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

function safeReturnUrl(raw: string | null, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return fallback;
  }
  return raw;
}

function goAfterSignIn(path: string, routerReplace: (href: string) => void): void {
  routerReplace(path);
}

function LoginLoading({ message = "Loading…" }: { message?: string }) {
  const desktop = useLedgeIndexDesktop();
  return (
    <div
      className={cn(
        "relative flex min-h-dvh flex-col items-center justify-center",
        desktop && "pt-9",
      )}
    >
      <DesktopTitleBar />
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

function LoginContent() {
  const { user, loading, signInWithGoogle } = useAuth();
  const desktop = useLedgeIndexDesktop();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = safeReturnUrl(
    searchParams.get("returnUrl"),
    desktop ? "/chat" : "/dashboard",
  );
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    router.replace(returnUrl);
  }, [loading, user, router, returnUrl]);

  async function handleGoogleSignIn() {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // Popup path (browser). Desktop redirect navigates away before this.
      goAfterSignIn(returnUrl, (href) => router.replace(href));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sign-in failed";
      const hint =
        message.includes("permission") || message.includes("PERMISSION_DENIED")
          ? "Firestore rules missing — publish ledgeindex/firestore.rules in Firebase Console."
          : null;
      setError(hint ? `${message}. ${hint}` : message);
    } finally {
      setSigningIn(false);
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <DesktopTitleBar />
        <SiteBrand className="justify-center" />
        <p className="mt-8 text-sm text-muted">
          Add Firebase web config to{" "}
          <code className="font-mono text-xs">ledgeindex/.env.local</code>{" "}
          (see <code className="font-mono text-xs">.env.example</code>).
        </p>
      </div>
    );
  }

  if (loading || user) {
    return (
      <LoginLoading
        message={user ? "Signing you in…" : "Loading…"}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative flex min-h-dvh flex-col items-center justify-center px-4 py-12",
        desktop && "pt-16",
      )}
    >
      <DesktopTitleBar />
      <div
        aria-hidden
        className="section-glow-cool pointer-events-none absolute inset-0"
      />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <SiteBrand href="/" />
          <p className="text-sm text-muted">
            Sign in to manage knowledge sets and crawl sources.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card-solid p-8 shadow-card">
          {error ? (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <Button
            variant="secondary"
            className="h-11 w-full gap-2 rounded-xl"
            disabled={signingIn}
            onClick={() => void handleGoogleSignIn()}
          >
            <GoogleIcon />
            {signingIn ? "Signing in…" : "Continue with Google"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginContent />
    </Suspense>
  );
}
