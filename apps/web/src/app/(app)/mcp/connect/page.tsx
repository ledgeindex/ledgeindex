"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Loader2, Plug, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { resolveDesktopLocalApiUrl } from "@/lib/desktop-api-routing";
import { getMastraApiBaseUrl } from "@/lib/ledgeindex-api";
import {
  getLedgeIndexDesktop,
  useLedgeIndexDesktop,
} from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

function mcpHttpUrlFromBase(base: string): string {
  return `${base.replace(/\/$/, "")}/mcp`;
}

function McpConfigExample() {
  const desktop = useLedgeIndexDesktop();
  const [copied, setCopied] = useState(false);
  const [localOrigin, setLocalOrigin] = useState(() =>
    desktop ? resolveDesktopLocalApiUrl() : getMastraApiBaseUrl(),
  );

  useEffect(() => {
    if (!desktop?.getApiOrigin) return;
    let cancelled = false;
    void desktop.getApiOrigin().then((origin) => {
      if (!cancelled && origin) setLocalOrigin(origin);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const isDesktop = Boolean(desktop ?? getLedgeIndexDesktop());
  const mcpUrl = useMemo(
    () =>
      mcpHttpUrlFromBase(
        isDesktop ? localOrigin || resolveDesktopLocalApiUrl() : getMastraApiBaseUrl(),
      ),
    [isDesktop, localOrigin],
  );

  const configJson = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            [isDesktop ? "ledgeindex-desktop" : "ledgeindex"]: {
              url: mcpUrl,
            },
          },
        },
        null,
        2,
      ),
    [isDesktop, mcpUrl],
  );

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(configJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Plug className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">
            {isDesktop ? "LedgeIndex Desktop MCP" : "LedgeIndex MCP"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isDesktop
              ? "Connect Cursor to this machine’s local sidecar — personal sources on :3015."
              : "Add this server in Cursor (or another MCP client). Consent only appears when the client opens a connect link."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Example mcp.json
          </p>
          <button
            type="button"
            onClick={() => void copyConfig()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          className={cn(
            "overflow-x-auto rounded-xl border border-border bg-muted/30 p-4",
            "font-mono text-[0.75rem] leading-5 text-foreground",
          )}
        >
          {configJson}
        </pre>
      </div>

      {isDesktop ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Keep the desktop app running so the sidecar stays up. Local MCP skips
          cloud OAuth and uses your desktop user id for{" "}
          <span className="font-mono">list_personal_sources</span> /{" "}
          <span className="font-mono">ask_source</span>. Restart Cursor after
          saving mcp.json.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          After you connect from the client, you&apos;ll be redirected here with a
          session to Allow or Cancel access for your account.
        </p>
      )}
    </div>
  );
}

function McpConsentContent({ oauthSession }: { oauthSession: string }) {
  const { user, loading: authLoading, getAuthToken } = useAuth();
  const [sessionInfo, setSessionInfo] = useState<{
    client_id?: string;
    scope?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mastraBase = getMastraApiBaseUrl().replace(/\/$/, "");
    fetch(
      `${mastraBase}/oauth/session?oauth_session=${encodeURIComponent(oauthSession)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error("Invalid or expired connect session");
        return res.json();
      })
      .then((data) => setSessionInfo(data))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load session"),
      )
      .finally(() => setLoading(false));
  }, [oauthSession]);

  const finishConsent = useCallback(
    async (approve: boolean) => {
      setSubmitting(true);
      setError(null);
      try {
        const token = await getAuthToken();
        if (!token) throw new Error("Sign in required");

        const mastraBase = getMastraApiBaseUrl().replace(/\/$/, "");
        const endpoint = approve
          ? `${mastraBase}/oauth/consent/approve`
          : `${mastraBase}/oauth/consent/deny`;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ oauth_session: oauthSession }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            data?.error_description ?? data?.error ?? "Consent failed",
          );
        }
        if (data.redirect_uri) {
          window.location.href = data.redirect_uri;
          return;
        }
        throw new Error("No redirect from server");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Consent failed");
      } finally {
        setSubmitting(false);
      }
    },
    [oauthSession, getAuthToken],
  );

  if (loading || authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Plug className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Connect to LedgeIndex MCP</h1>
          <p className="text-sm text-muted-foreground">
            {sessionInfo?.client_id
              ? `Client: ${sessionInfo.client_id}`
              : "External MCP client"}
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!user ? (
        <p className="text-sm text-muted-foreground">
          Sign in to the LedgeIndex app, then reopen this connect link from your
          MCP client.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Account
            </p>
            <p className="mt-1 font-medium">
              {user.displayName ?? "LedgeIndex user"}
            </p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>

          <div className="flex gap-2 text-sm text-muted-foreground">
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This client may list your knowledge sources, read source sets, and
              ask questions against indexed documentation.
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              className="flex-1"
              disabled={submitting}
              onClick={() => finishConsent(true)}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Allow"
              )}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={submitting}
              onClick={() => finishConsent(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function McpConnectContent() {
  const searchParams = useSearchParams();
  const oauthSession = searchParams.get("oauth_session") ?? "";

  if (!oauthSession) {
    return <McpConfigExample />;
  }

  return <McpConsentContent oauthSession={oauthSession} />;
}

export default function McpConnectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <McpConnectContent />
    </Suspense>
  );
}
