"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getSource,
  getProfileSiteRun,
  startSourceAgentGuideRun,
  updateSourceSiteProfile,
  type SiteProfile,
} from "@/lib/ledgeindex-api";

type GuideTopic = {
  name: string;
  description: string;
  priority: "main" | "top";
};

const MAX_AGENT_GUIDE_TOPICS = 25;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function topicsFromProfile(profile: Record<string, unknown>): GuideTopic[] {
  const docsTopics = record(profile.docs_topics);
  const capabilities = record(profile.capabilities);
  const rows = Array.isArray(docsTopics?.topics)
    ? docsTopics.topics
    : capabilities?.capabilities;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(record)
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .filter((row) => row.priority === "main" || row.priority === "top")
    .map((row) => ({
      name: String(row.name ?? "").trim(),
      description: String(row.description ?? "").trim(),
      priority: row.priority === "main" ? ("main" as const) : ("top" as const),
    }))
    .filter((topic) => topic.name && topic.description)
    .slice(0, MAX_AGENT_GUIDE_TOPICS);
}

export function AgentGuideReviewDialog({
  open,
  sourceId,
  mode = "generate",
  onComplete,
}: {
  open: boolean;
  sourceId: string;
  mode?: "generate" | "edit";
  onComplete: (saved: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<"generating" | "review" | "error">(
    "generating",
  );
  const [summary, setSummary] = useState("");
  const [guideHint, setGuideHint] = useState("");
  const [topics, setTopics] = useState<GuideTopic[]>([]);
  const [rawProfile, setRawProfile] = useState<Record<string, unknown>>({});
  const [runId, setRunId] = useState<string>();
  const [rootUrl, setRootUrl] = useState("");
  const [lensSources, setLensSources] =
    useState<SiteProfile["lensSources"]>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => setMounted(true), []);

  const generate = useCallback(async (hint?: string) => {
    if (!open) return;
    setPhase("generating");
    setError(undefined);
    try {
      const { run: started } = await startSourceAgentGuideRun(sourceId, {
        hint,
      });
      setRunId(started.id);
      setRootUrl(started.rootUrl);

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const { run } = await getProfileSiteRun(started.id);
        if (run.status === "failed") {
          throw new Error(run.error || "Agent guide generation failed");
        }
        if (run.status !== "completed") continue;

        const profile = run.profile ?? {};
        const identity = record(profile.docs_identity);
        const nextSummary = String(identity?.overallSummary ?? "").trim();
        if (!nextSummary) {
          throw new Error("The generated guide did not include a summary");
        }
        setRawProfile(profile);
        setSummary(nextSummary);
        setTopics(topicsFromProfile(profile));
        setLensSources(run.lensSources);
        setPhase("review");
        return;
      }
      throw new Error("Timed out while generating the agent guide");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Agent guide generation failed",
      );
      setPhase("error");
    }
  }, [open, sourceId]);

  const initialize = useCallback(async () => {
    if (!open) return;
    if (mode === "generate") {
      await generate();
      return;
    }

    setPhase("generating");
    setError(undefined);
    try {
      const { source } = await getSource(sourceId);
      const savedProfile = source.sourceMetadata?.siteProfile;
      const profile = savedProfile?.profile ?? {};
      const identity = record(profile.docs_identity);
      const savedSummary = String(
        identity?.overallSummary ??
          source.sourceMetadata?.docsIdentity?.overallSummary ??
          "",
      ).trim();
      if (!savedProfile || !savedSummary) {
        throw new Error("This source does not have a saved Agent Guide yet");
      }

      setRawProfile(profile);
      setSummary(savedSummary);
      setTopics(topicsFromProfile(profile));
      setRootUrl(
        savedProfile.rootUrl ||
          source.canonicalUrl ||
          source.config.startUrls?.[0] ||
          "",
      );
      setLensSources(savedProfile.lensSources);
      setRunId(savedProfile.runId);
      setGuideHint(savedProfile.guideHint ?? "");
      setPhase("review");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to load Agent Guide",
      );
      setPhase("error");
    }
  }, [generate, mode, open, sourceId]);

  useEffect(() => {
    if (open) void initialize();
  }, [open, initialize]);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const identity = record(rawProfile.docs_identity) ?? {};
      const docsTopics = record(rawProfile.docs_topics) ?? {};
      const capabilities = record(rawProfile.capabilities) ?? {};
      const originalTopics = Array.isArray(docsTopics.topics)
        ? docsTopics.topics
        : Array.isArray(capabilities.capabilities)
          ? capabilities.capabilities
          : [];
      const editableOriginals = originalTopics
        .map(record)
        .filter(
          (topic): topic is Record<string, unknown> =>
            topic !== null &&
            (topic.priority === "main" || topic.priority === "top"),
        );
      const mergedTopics = topics.map((topic, index) => ({
        ...(editableOriginals[index] ?? {}),
        ...topic,
      }));
      const now = new Date().toISOString();
      await updateSourceSiteProfile(sourceId, {
        rootUrl,
        lenses: ["docs_identity", "docs_topics"],
        profile: {
          ...rawProfile,
          docs_identity: {
            ...identity,
            overallSummary: summary.trim(),
          },
          docs_topics: {
            ...docsTopics,
            topics: mergedTopics,
          },
        },
        lensSources,
        generatedAt: now,
        runId,
        guideHint: guideHint.trim() || undefined,
      });
      onComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save guide");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/55 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-guide-title"
        className="flex max-h-[min(48rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 id="agent-guide-title" className="text-base font-semibold">
              {mode === "edit" ? "Edit Agent Guide" : "Agent guide"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              This guide helps the assistant understand what this source covers
              and improves query rewriting. Answers are still grounded in
              retrieved pages.
            </p>
            {rootUrl ? (
              <a
                href={rootUrl}
                target="_blank"
                rel="noreferrer"
                title={rootUrl}
                className="mt-1.5 inline-flex max-w-full items-center gap-1 font-mono text-[0.625rem] text-muted transition-colors hover:text-foreground"
              >
                <span className="truncate">{rootUrl}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {mode === "edit" ? (
              <button
                type="button"
                disabled={saving || phase === "generating"}
                onClick={() => {
                  if (
                    phase === "review" &&
                    !window.confirm(
                      "Regenerate this guide from the indexed pages? Unsaved edits will be replaced.",
                    )
                  ) {
                    return;
                  }
                  void generate(guideHint);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Regenerate
              </button>
            ) : null}
            <button
              type="button"
              aria-label={
                mode === "edit" ? "Close Agent Guide" : "Skip Agent Guide"
              }
              onClick={() => onComplete(false)}
              disabled={saving}
              className="rounded-md p-1 text-muted hover:bg-surface-raised hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {phase === "generating" ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Building the guide from indexed pages…
            </div>
          ) : phase === "error" ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600">{error}</p>
              <label className="block">
                <span className="text-xs font-medium">
                  Guide hint{" "}
                  <span className="font-normal text-muted">(optional)</span>
                </span>
                <textarea
                  value={guideHint}
                  onChange={(event) => setGuideHint(event.target.value)}
                  maxLength={4_000}
                  rows={5}
                  placeholder="For example: Focus on agents, workflows, observability, and deployment."
                  className="mt-2 w-full resize-y rounded-lg border border-border bg-card-solid p-3 text-sm leading-6 outline-none focus:border-foreground/30"
                />
                <span className="mt-1 block text-[0.6875rem] leading-5 text-muted">
                  Influences both page selection and what the generated guide
                  emphasizes.
                </span>
              </label>
              <Button type="button" onClick={() => void generate(guideHint)}>
                {mode === "edit" ? "Generate guide" : "Try again"}
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <label className="block">
                <span className="text-xs font-medium">
                  Guide hint{" "}
                  <span className="font-normal text-muted">(optional)</span>
                </span>
                <textarea
                  value={guideHint}
                  onChange={(event) => setGuideHint(event.target.value)}
                  maxLength={4_000}
                  rows={5}
                  placeholder="For example: Focus on agents, workflows, observability, and deployment."
                  className="mt-2 w-full resize-y rounded-lg border border-border bg-card-solid p-3 text-sm leading-6 outline-none focus:border-foreground/30"
                />
                <span className="mt-1 block text-[0.6875rem] leading-5 text-muted">
                  Used when regenerating to influence page selection and what
                  the generated guide emphasizes.
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Documentation overview</span>
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  maxLength={1_000}
                  rows={5}
                  className="mt-2 w-full resize-y rounded-lg border border-border bg-card-solid p-3 text-sm leading-6 outline-none focus:border-foreground/30"
                />
              </label>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium">
                    Main topics{" "}
                    <span className="font-normal text-muted">
                      ({topics.length}/{MAX_AGENT_GUIDE_TOPICS})
                    </span>
                  </p>
                  <button
                    type="button"
                    disabled={topics.length >= MAX_AGENT_GUIDE_TOPICS}
                    onClick={() =>
                      setTopics((current) => [
                        ...current,
                        { name: "", description: "", priority: "top" },
                      ])
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Add topic
                  </button>
                </div>
                {topics.map((topic, index) => (
                  <div
                    key={`${topic.priority}-${index}`}
                    className="grid gap-2 rounded-lg border border-border bg-card-solid p-3"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={topic.name}
                        maxLength={120}
                        placeholder="Topic name"
                        onChange={(event) =>
                          setTopics((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, name: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-2 text-sm font-medium outline-none"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${topic.name || "topic"}`}
                        onClick={() =>
                          setTopics((current) =>
                            current.filter(
                              (_, entryIndex) => entryIndex !== index,
                            ),
                          )
                        }
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    <textarea
                      value={topic.description}
                      maxLength={500}
                      rows={2}
                      placeholder="What this topic covers"
                      onChange={(event) =>
                        setTopics((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, description: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      className="resize-y rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-5 outline-none"
                    />
                  </div>
                ))}
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border p-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onComplete(false)}
            disabled={saving}
          >
            {mode === "edit" ? "Close" : "Skip for now"}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={
              phase !== "review" ||
              saving ||
              !summary.trim() ||
              topics.length === 0 ||
              topics.some(
                (topic) => !topic.name.trim() || !topic.description.trim(),
              )
            }
          >
            {saving
              ? "Saving…"
              : mode === "edit"
                ? "Save guide"
                : "Save and finish"}
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
