"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createProject,
  createSource,
  getProfileSiteRun,
  KnowledgeIndexApiError,
  normalizeStartUrl,
  startProfileSiteRun,
  updateSourceSiteProfile,
  type SiteProfile,
  type WebCrawlConfig,
} from "@/lib/ledgeindex-api";
import { getDevProjectId, setDevProjectId } from "@/lib/dev-project";
import {
  DEFAULT_SITE_PROFILE_LENS_IDS,
  FULL_SITE_PROFILE_LENS_IDS,
  SITE_PROFILE_LENS_GROUPS,
  getSiteProfileLensOption,
  type SiteProfileLensId,
} from "@/lib/site-profile-lenses";
import { cn } from "@/lib/utils";

const PROFILE_ONLY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function profileOnlyConfig(startUrl: string): WebCrawlConfig {
  return {
    startUrls: [startUrl],
    includePatterns: [],
    excludePatterns: [],
    excludeDownloadPatterns: [],
    patternsAreRegex: false,
    renderJs: false,
    useProxy: false,
    enableSitemap: false,
    sitemapOnly: false,
    sitemapUrls: [],
    fileTypes: ["html"],
    contentSelectors: [],
    excludeSelectors: [],
    maxPages: 1000,
    userAgent: PROFILE_ONLY_USER_AGENT,
  };
}

function defaultSourceName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "Profile";
  }
}

async function ensureProjectId(): Promise<string> {
  const existing = getDevProjectId();
  if (existing) return existing;
  const { project } = await createProject("My LedgeIndex project");
  setDevProjectId(project.id);
  return project.id;
}

async function createProfileSource(input: {
  name: string;
  rootUrl: string;
  profile: SiteProfile;
}): Promise<string> {
  let projectId = await ensureProjectId();
  const create = () =>
    createSource({
      projectId,
      name: input.name,
      scope: "personal",
      config: profileOnlyConfig(input.rootUrl),
    });

  try {
    const { source } = await create();
    await updateSourceSiteProfile(source.id, input.profile);
    return source.id;
  } catch (error) {
    if (!(error instanceof KnowledgeIndexApiError) || error.status !== 404) {
      throw error;
    }
    const { project } = await createProject("My LedgeIndex project");
    projectId = project.id;
    setDevProjectId(projectId);
    const { source } = await create();
    await updateSourceSiteProfile(source.id, input.profile);
    return source.id;
  }
}

export function AddProfileSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (sourceId: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<SiteProfileLensId>>(
    () => new Set(DEFAULT_SITE_PROFILE_LENS_IDS),
  );
  const [sitemapOnly, setSitemapOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function run() {
    const rootUrl = normalizeStartUrl(url);
    if (!rootUrl) {
      setError("Enter a valid website URL");
      return;
    }

    setRunning(true);
    setError(null);
    setStatus("Starting profile…");
    try {
      const lenses = [...selected];
      const { run: started } = await startProfileSiteRun({
        url: rootUrl,
        lenses,
        sitemapOnly,
      });
      const deadline = Date.now() + 12 * 60_000;

      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const { run: current } = await getProfileSiteRun(started.id);
        if (current.status === "failed") {
          throw new Error(current.error || "Profile run failed");
        }
        if (current.status !== "completed") {
          const phase = current.progress?.phase ?? "crawl";
          setStatus(
            phase === "crawl"
              ? "Discovering pages…"
              : phase === "synthesize"
                ? "Writing profile…"
                : "Analyzing site…",
          );
          continue;
        }

        const profile: SiteProfile = {
          rootUrl: current.rootUrl || rootUrl,
          lenses: current.lenses?.length ? current.lenses : lenses,
          profile: (current.profile ?? {}) as Record<string, unknown>,
          lensSources: current.lensSources,
          generatedAt: new Date().toISOString(),
          runId: current.id,
        };
        setStatus("Saving profile source…");
        const sourceId = await createProfileSource({
          name: name.trim() || defaultSourceName(rootUrl),
          rootUrl,
          profile,
        });
        onCreated(sourceId);
        onOpenChange(false);
        return;
      }
      throw new Error("Timed out waiting for profile run");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create profile");
    } finally {
      setRunning(false);
      setStatus("");
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50"
        onClick={() => !running && onOpenChange(false)}
      />
      <div className="relative z-[1] flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card-solid p-5 shadow-card">
        <h2 className="text-sm font-semibold text-foreground">
          Add profile
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Analyze a website and save its profile without creating a searchable
          index. You can crawl it later.
        </p>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[0.625rem] font-semibold tracking-[0.08em] text-muted uppercase">
                Website URL
              </span>
              <input
                autoFocus
                type="url"
                value={url}
                disabled={running}
                placeholder="https://docs.example.com"
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(null);
                }}
                className="field-input w-full text-sm normal-case"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[0.625rem] font-semibold tracking-[0.08em] text-muted uppercase">
                Name (optional)
              </span>
              <input
                type="text"
                value={name}
                maxLength={200}
                disabled={running}
                placeholder="Uses the website hostname"
                onChange={(event) => setName(event.target.value)}
                className="field-input w-full text-sm normal-case"
              />
            </label>
          </div>

          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-foreground">
                  Profile lenses
                </h3>
                <p className="mt-0.5 text-[0.6875rem] text-muted">
                  Choose exactly what the profile should research.
                </p>
              </div>
              <div className="flex gap-1.5">
                {[
                  {
                    id: "default",
                    label: "Default",
                    lenses: DEFAULT_SITE_PROFILE_LENS_IDS,
                  },
                  {
                    id: "full",
                    label: "Full profile",
                    lenses: FULL_SITE_PROFILE_LENS_IDS,
                  },
                ].map((preset) => {
                  const active =
                    preset.lenses.length === selected.size &&
                    preset.lenses.every((id) => selected.has(id));
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={running}
                      onClick={() => setSelected(new Set(preset.lenses))}
                      className={cn(
                        "rounded-md border px-2 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] uppercase transition-colors",
                        active
                          ? "border-foreground/20 bg-foreground text-background"
                          : "border-border bg-surface-raised text-muted hover:text-foreground",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {SITE_PROFILE_LENS_GROUPS.map((group) => (
                <div
                  key={group.id}
                  className="rounded-lg border border-border bg-surface-raised/50 p-2.5"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">
                      {group.label}
                    </p>
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => {
                        const allSelected = group.lensIds.every((id) =>
                          selected.has(id),
                        );
                        setSelected((current) => {
                          const next = new Set(current);
                          for (const id of group.lensIds) {
                            if (allSelected) next.delete(id);
                            else next.add(id);
                          }
                          return next;
                        });
                      }}
                      className="text-[0.625rem] font-medium text-muted hover:text-foreground"
                    >
                      {group.lensIds.every((id) => selected.has(id))
                        ? "Clear"
                        : "All"}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {group.lensIds.map((id) => {
                      const option = getSiteProfileLensOption(id);
                      return (
                        <label
                          key={id}
                          title={option.description}
                          className="flex cursor-pointer items-center gap-2 text-xs text-muted hover:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(id)}
                            disabled={running}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                return next;
                              })
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised/50 px-3 py-2.5">
            <span>
              <span className="block text-xs font-medium text-foreground">
                Sitemap only
              </span>
              <span className="mt-0.5 block text-[0.6875rem] text-muted">
                Faster discovery using sitemap.xml instead of following links.
              </span>
            </span>
            <input
              type="checkbox"
              checked={sitemapOnly}
              disabled={running}
              onChange={(event) => setSitemapOnly(event.target.checked)}
            />
          </label>
        </div>

        {status ? <p className="mt-3 text-xs text-muted">{status}</p> : null}
        {error ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={running}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={running || !url.trim() || selected.size === 0}
            onClick={() => void run()}
          >
            {running ? "Creating…" : "Create profile"}
          </Button>
        </div>
      </div>
    </div>
  );
}
