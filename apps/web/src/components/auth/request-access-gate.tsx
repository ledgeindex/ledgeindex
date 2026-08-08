"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { requestAccess } from "@/lib/access-api";
import { Button } from "@/components/ui/button";
import { SiteBrand } from "@/components/site-brand";

/**
 * Shown in place of the app while an account waits for early-access approval. The API
 * already refuses their requests, so this only explains why.
 */
export function RequestAccessGate() {
  const { user, accessStatus, signOut } = useAuth();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const denied = accessStatus === "denied";

  async function submit() {
    setSending(true);
    setError(null);
    try {
      await requestAccess(note);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <SiteBrand href="/" showWordmark />
        </div>

        <div className="rounded-2xl border border-border bg-card-solid p-6">
          <h1 className="text-lg font-semibold text-foreground">
            {denied ? "Access not granted" : "LedgeIndex is invite-only"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {denied
              ? "Your request was declined. Reply to your signup email if you think this is a mistake."
              : "We're onboarding accounts in batches while things settle. Ask for access and we'll email you when your account is opened up."}
          </p>

          {user?.email ? (
            <p className="mt-4 font-mono text-xs text-muted">{user.email}</p>
          ) : null}

          {!denied && !sent ? (
            <>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Optional: what do you want to index?"
                className="mt-4 w-full resize-none rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-foreground/20 focus:outline-none"
              />
              <Button
                className="mt-3 w-full"
                onClick={() => void submit()}
                disabled={sending}
              >
                {sending ? "Sending…" : "Request access"}
              </Button>
            </>
          ) : null}

          {sent ? (
            <p className="mt-4 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-foreground">
              Request received — we'll be in touch.
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>
          ) : null}

          <Button
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
