"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getLedgeIndexDesktop,
  useLedgeIndexDesktop,
  type DesktopProviderId,
  type DesktopProviderKeyStatus,
} from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

const PROVIDERS: {
  id: DesktopProviderId;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "sk-...",
    hint: "GPT models — platform.openai.com",
  },
  {
    id: "google",
    label: "Gemini",
    placeholder: "AIza...",
    hint: "Gemini models — Google AI Studio",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    placeholder: "sk-...",
    hint: "DeepSeek models — platform.deepseek.com",
  },
];

function emptyDraft(): Record<DesktopProviderId, string> {
  return { openai: "", google: "", deepseek: "" };
}

function emptyStatus(): DesktopProviderKeyStatus {
  return { openai: false, google: false, deepseek: false };
}

/** Desktop-only: LLM provider keys for the local sidecar. */
export default function DesktopProviderKeysPage(): React.JSX.Element {
  const desktopHook = useLedgeIndexDesktop();
  // Prefer hook, but never bounce away on a one-frame null — sync bridge first.
  const desktop = desktopHook ?? getLedgeIndexDesktop();
  const [status, setStatus] = useState<DesktopProviderKeyStatus>(emptyStatus);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop?.getProviderKeyStatus) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void desktop.getProviderKeyStatus().then((next) => {
      if (!cancelled) {
        setStatus(next);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  if (!desktop) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold text-foreground">Model API keys</h1>
        <p className="text-sm text-muted">
          Waiting for the desktop bridge… Restart the app if this stays blank.
        </p>
      </div>
    );
  }

  if (!desktop.getProviderKeyStatus || !desktop.saveProviderKeys) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold text-foreground">Model API keys</h1>
        <p className="text-sm text-muted">
          This desktop build is missing provider-key support. Fully quit and
          restart the app so preload updates load.
        </p>
      </div>
    );
  }

  async function persist(keys: Partial<Record<DesktopProviderId, string>>) {
    if (!desktop?.saveProviderKeys || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await desktop.saveProviderKeys(keys);
      setStatus(next);
      setDraft(emptyDraft());
      setMessage("Saved. Local server restarted with the new keys.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    const keys: Partial<Record<DesktopProviderId, string>> = {};
    for (const provider of PROVIDERS) {
      const value = draft[provider.id].trim();
      if (value) keys[provider.id] = value;
    }
    if (Object.keys(keys).length === 0) {
      setMessage("Nothing to save — enter a new key, or use Remove.");
      return;
    }
    await persist(keys);
  }

  async function onRemove(id: DesktopProviderId) {
    await persist({ [id]: "" });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Model API keys</h1>
        <p className="mt-1 text-sm text-muted">
          Keys are encrypted on this machine and passed to the local desktop
          server. Leave a field blank to keep the existing key. Use Remove to
          delete a saved key.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-4 rounded-xl border border-border bg-card-solid p-4 shadow-card">
          {PROVIDERS.map((provider) => (
            <label key={provider.id} className="block space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {provider.label}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-mono text-[0.65rem] font-semibold tracking-wide uppercase",
                      status[provider.id] ? "text-foreground" : "text-muted",
                    )}
                  >
                    {status[provider.id] ? "Saved" : "Not set"}
                  </span>
                  {status[provider.id] ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onRemove(provider.id)}
                      className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  status[provider.id]
                    ? "••••••••  (leave blank to keep)"
                    : provider.placeholder
                }
                value={draft[provider.id]}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    [provider.id]: event.target.value,
                  }))
                }
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none ring-foreground/20 placeholder:text-muted focus:ring-2"
              />
              <p className="text-xs text-muted">{provider.hint}</p>
            </label>
          ))}

          {error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground">
              {message}
            </p>
          ) : null}

          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={saving}
            onClick={() => void onSave()}
          >
            {saving ? "Saving…" : "Save keys"}
          </Button>
        </div>
      )}
    </div>
  );
}
