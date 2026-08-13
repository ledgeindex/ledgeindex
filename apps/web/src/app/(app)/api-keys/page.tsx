"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { ApiKeyRow } from "@/components/api-keys/api-key-row";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import {
  createApiKey,
  deleteApiKey,
  KnowledgeIndexApiError,
  listApiKeys,
  getLedgeIndexApiBaseUrl,
  type ApiKeySummary,
} from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

export default function ApiKeysPage() {
  const { isAdmin } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [limit, setLimit] = useState(1);
  const [canCreate, setCanCreate] = useState(false);
  const [canRevoke, setCanRevoke] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadedRef = useRef(false);

  async function loadKeys() {
    setLoading(true);
    setError(null);
    try {
      const result = await listApiKeys();
      setApiKeys(result.data);
      setLimit(result.meta.api_key_limit);
      setCanCreate(result.meta.can_create);
      setCanRevoke(result.meta.can_revoke);
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to load API keys",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadKeys();
  }, []);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await createApiKey();
      await loadKeys();
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to create API key",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(keyId: string) {
    setDeletingId(keyId);
    setError(null);
    try {
      await deleteApiKey(keyId);
      await loadKeys();
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to delete API key",
      );
    } finally {
      setDeletingId(null);
    }
  }

  const atLimit = apiKeys.length >= limit;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="section-glow-cool pointer-events-none absolute inset-0"
      />

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        {error ? (
          <div className="mb-4 shrink-0 rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised/80 px-3 py-2 shadow-card">
            <KeyRound className="size-4 text-muted" />
            <span className="font-mono text-xs text-muted">
              {apiKeys.length}/{limit} keys
            </span>
          </div>

          {canCreate ? (
            <Button
              variant="secondary"
              className="h-10 rounded-lg px-4 text-xs"
              disabled={atLimit || creating}
              onClick={() => void handleCreate()}
            >
              {creating ? "Creating…" : "Add API key"}
            </Button>
          ) : null}
        </div>

        <p className="mb-4 text-sm text-muted">
          {isAdmin
            ? "Your Playground key is provisioned automatically. Use Add API key for production."
            : "Your Playground key is provisioned automatically. Copy it anytime below."}
        </p>

        {loading ? (
          <p className="text-sm text-muted">Loading keys…</p>
        ) : apiKeys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card-solid/60 px-6 py-12 text-center shadow-card">
            <p className="text-sm text-muted">
              No API key yet. Sign out and back in if this persists.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {apiKeys.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                canRevoke={canRevoke}
                deleting={deletingId === key.id}
                onRevoke={handleDelete}
              />
            ))}
          </div>
        )}

        <div
          className={cn(
            "mt-8 overflow-hidden rounded-xl border border-border bg-surface-raised/80 p-4 shadow-card",
          )}
        >
          <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Usage
          </p>
          <pre className="field-input mt-3 overflow-x-auto font-mono text-xs leading-relaxed">
{`curl ${getLedgeIndexApiBaseUrl()}/api/projects \\
  -H "Authorization: ApiKey live_..."`}
          </pre>
        </div>
      </div>
    </div>
  );
}
