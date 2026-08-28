"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applySourceRefresh,
  cancelSourceRefresh,
  dismissSourceRefresh,
  getCrawlProgress,
  getLedgeIndexApiBaseUrl,
  getSourceRefreshStatus,
  listSourceRefreshRuns,
  resolveRemoteApiBaseUrl,
  startSourceRefreshCheck,
  type RefreshRunSnapshot,
} from "@/lib/ledgeindex-api";
import {
  resolveApiBaseForHosting,
  resolveDesktopLocalApiUrl,
  resolveWebLocalApiUrl,
} from "@/lib/desktop-api-routing";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { isRefreshRunBusy } from "@/components/sources/source-refresh-view";

const POLL_MS = 1500;

export type SourceRefreshJobInput = {
  sourceId: string;
  sourceName: string;
  sourceStartUrl: string;
  sourceScope?: "personal" | "global";
  hosting?: "local" | "cloud";
};

export type SourceRefreshJob = SourceRefreshJobInput & {
  sourceScope: "personal" | "global";
  baseUrl: string;
  snapshot: RefreshRunSnapshot | null;
  discoverCount: number;
  error: string | null;
  busy: boolean;
};

type SourceRefreshJobsContextValue = {
  jobs: SourceRefreshJob[];
  panelOpen: boolean;
  selectedSourceId: string | null;
  runningCount: number;
  readyCount: number;
  startJob: (input: SourceRefreshJobInput) => Promise<void>;
  openPanel: (sourceId?: string) => void;
  closePanel: () => void;
  selectJob: (sourceId: string) => void;
  cancelJob: (sourceId: string) => Promise<void>;
  dismissJob: (sourceId: string) => Promise<void>;
  applyJob: (sourceId: string) => Promise<void>;
};

const sourceRefreshJobsGlobal = globalThis as typeof globalThis & {
  __ledgeindexSourceRefreshJobsContext?: ReturnType<
    typeof createContext<SourceRefreshJobsContextValue | null>
  >;
};

const SourceRefreshJobsContext =
  sourceRefreshJobsGlobal.__ledgeindexSourceRefreshJobsContext ??
  createContext<SourceRefreshJobsContextValue | null>(null);

sourceRefreshJobsGlobal.__ledgeindexSourceRefreshJobsContext =
  SourceRefreshJobsContext;

function jobBaseUrl(input: SourceRefreshJobInput): string {
  const scope = input.sourceScope === "global" ? "global" : "personal";
  const hosting = input.hosting === "cloud" ? "cloud" : "local";
  return resolveApiBaseForHosting({ scope, hosting });
}

function toJob(
  input: SourceRefreshJobInput,
  patch?: Partial<SourceRefreshJob>,
): SourceRefreshJob {
  const sourceScope = input.sourceScope === "global" ? "global" : "personal";
  return {
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceStartUrl: input.sourceStartUrl,
    sourceScope,
    hosting: input.hosting,
    baseUrl: patch?.baseUrl ?? jobBaseUrl({ ...input, sourceScope }),
    snapshot: patch?.snapshot ?? null,
    discoverCount: patch?.discoverCount ?? 0,
    error: patch?.error ?? null,
    busy: patch?.busy ?? false,
  };
}

function listApiBases(): string[] {
  const bases = new Set<string>();
  const desktop = Boolean(getLedgeIndexDesktop());
  bases.add(desktop ? resolveDesktopLocalApiUrl() : resolveWebLocalApiUrl());
  const remote = resolveRemoteApiBaseUrl();
  if (remote) bases.add(remote);
  const active = getLedgeIndexApiBaseUrl();
  if (active) bases.add(active);
  return [...bases].filter(Boolean);
}

export function SourceRefreshJobsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [jobs, setJobs] = useState<SourceRefreshJob[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const upsertJob = useCallback(
    (sourceId: string, updater: (current: SourceRefreshJob) => SourceRefreshJob) => {
      setJobs((current) => {
        const index = current.findIndex((job) => job.sourceId === sourceId);
        if (index < 0) return current;
        const next = [...current];
        next[index] = updater(current[index]);
        return next;
      });
    },
    [],
  );

  const mergeJobs = useCallback((incoming: SourceRefreshJob[]) => {
    setJobs((current) => {
      const byId = new Map(current.map((job) => [job.sourceId, job]));
      for (const job of incoming) {
        const existing = byId.get(job.sourceId);
        byId.set(job.sourceId, existing ? { ...existing, ...job } : job);
      }
      return [...byId.values()];
    });
  }, []);

  const hydrate = useCallback(async () => {
    const collected: SourceRefreshJob[] = [];
    await Promise.all(
      listApiBases().map(async (baseUrl) => {
        try {
          const { runs } = await listSourceRefreshRuns({ baseUrl });
          for (const run of runs) {
            collected.push(
              toJob(run, {
                baseUrl,
                snapshot: run.snapshot,
              }),
            );
          }
        } catch {
          // Local or remote API may be down; keep whatever we already track.
        }
      }),
    );
    if (collected.length > 0) mergeJobs(collected);
  }, [mergeJobs]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const pollJob = useCallback(
    async (job: SourceRefreshJob) => {
      try {
        const { snapshot } = await getSourceRefreshStatus(job.sourceId, {
          baseUrl: job.baseUrl,
        });
        let discoverCount = job.discoverCount;
        if (snapshot?.status === "discovering") {
          try {
            const progress = await getCrawlProgress(job.sourceId, {
              baseUrl: job.baseUrl,
            });
            if (progress.active) discoverCount = progress.pagesDiscovered;
          } catch {
            // Snapshot current/total is enough if crawl-progress isn't ready.
          }
        }
        upsertJob(job.sourceId, (current) => ({
          ...current,
          snapshot,
          discoverCount,
          error: snapshot ? null : current.error,
        }));
      } catch (err) {
        upsertJob(job.sourceId, (current) => ({
          ...current,
          error: err instanceof Error ? err.message : "Failed to load status",
        }));
      }
    },
    [upsertJob],
  );

  const runningIds = jobs
    .filter((job) => isRefreshRunBusy(job.snapshot?.status))
    .map((job) => job.sourceId)
    .join(",");

  useEffect(() => {
    if (!runningIds) return;

    const timer = window.setInterval(() => {
      for (const job of jobsRef.current) {
        if (isRefreshRunBusy(job.snapshot?.status)) {
          void pollJob(job);
        }
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [runningIds, pollJob]);

  const openPanel = useCallback((sourceId?: string) => {
    if (sourceId) setSelectedSourceId(sourceId);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const selectJob = useCallback((sourceId: string) => {
    setSelectedSourceId(sourceId);
  }, []);

  const startJob = useCallback(
    async (input: SourceRefreshJobInput) => {
      const next = toJob(input, { busy: true });
      setJobs((current) => {
        const existing = current.find((job) => job.sourceId === next.sourceId);
        if (existing) {
          return current.map((job) =>
            job.sourceId === next.sourceId
              ? { ...job, ...next, snapshot: null, discoverCount: 0, busy: true }
              : job,
          );
        }
        return [...current, next];
      });
      setSelectedSourceId(next.sourceId);
      setPanelOpen(true);

      try {
        const { snapshot } = await startSourceRefreshCheck(
          next.sourceId,
          "discover",
          { baseUrl: next.baseUrl },
        );
        upsertJob(next.sourceId, (current) => ({
          ...current,
          snapshot,
          busy: false,
          error: null,
        }));
      } catch (err) {
        upsertJob(next.sourceId, (current) => ({
          ...current,
          busy: false,
          error: err instanceof Error ? err.message : "Failed to start check",
        }));
      }
    },
    [upsertJob],
  );

  const cancelJob = useCallback(
    async (sourceId: string) => {
      const job = jobsRef.current.find((entry) => entry.sourceId === sourceId);
      if (!job) return;
      upsertJob(sourceId, (current) => ({ ...current, busy: true, error: null }));
      try {
        await cancelSourceRefresh(sourceId, { baseUrl: job.baseUrl });
        await pollJob({ ...job, busy: true });
        upsertJob(sourceId, (current) => ({ ...current, busy: false }));
      } catch (err) {
        upsertJob(sourceId, (current) => ({
          ...current,
          busy: false,
          error: err instanceof Error ? err.message : "Failed to cancel",
        }));
      }
    },
    [pollJob, upsertJob],
  );

  const dismissJob = useCallback(
    async (sourceId: string) => {
      const job = jobsRef.current.find((entry) => entry.sourceId === sourceId);
      if (!job) return;
      upsertJob(sourceId, (current) => ({ ...current, busy: true, error: null }));
      try {
        await dismissSourceRefresh(sourceId, { baseUrl: job.baseUrl });
        setSelectedSourceId((current) => (current === sourceId ? null : current));
        setJobs((current) => {
          const next = current.filter((entry) => entry.sourceId !== sourceId);
          if (next.length === 0) setPanelOpen(false);
          return next;
        });
      } catch (err) {
        upsertJob(sourceId, (current) => ({
          ...current,
          busy: false,
          error: err instanceof Error ? err.message : "Failed to dismiss",
        }));
      }
    },
    [upsertJob],
  );

  const applyJob = useCallback(
    async (sourceId: string) => {
      const job = jobsRef.current.find((entry) => entry.sourceId === sourceId);
      if (!job) return;
      upsertJob(sourceId, (current) => ({ ...current, busy: true, error: null }));
      try {
        const { snapshot } = await applySourceRefresh(sourceId, {
          baseUrl: job.baseUrl,
        });
        upsertJob(sourceId, (current) => ({
          ...current,
          snapshot,
          busy: false,
          error: null,
        }));
      } catch (err) {
        upsertJob(sourceId, (current) => ({
          ...current,
          busy: false,
          error: err instanceof Error ? err.message : "Failed to apply changes",
        }));
      }
    },
    [upsertJob],
  );

  const runningCount = jobs.filter((job) =>
    isRefreshRunBusy(job.snapshot?.status),
  ).length;
  const readyCount = jobs.filter(
    (job) => job.snapshot?.status === "ready",
  ).length;

  const value = useMemo(
    () => ({
      jobs,
      panelOpen,
      selectedSourceId,
      runningCount,
      readyCount,
      startJob,
      openPanel,
      closePanel,
      selectJob,
      cancelJob,
      dismissJob,
      applyJob,
    }),
    [
      jobs,
      panelOpen,
      selectedSourceId,
      runningCount,
      readyCount,
      startJob,
      openPanel,
      closePanel,
      selectJob,
      cancelJob,
      dismissJob,
      applyJob,
    ],
  );

  return (
    <SourceRefreshJobsContext.Provider value={value}>
      {children}
    </SourceRefreshJobsContext.Provider>
  );
}

export function useSourceRefreshJobs() {
  const context = useContext(SourceRefreshJobsContext);
  if (!context) {
    throw new Error(
      "useSourceRefreshJobs must be used within SourceRefreshJobsProvider",
    );
  }
  return context;
}

export function useOptionalSourceRefreshJobs() {
  return useContext(SourceRefreshJobsContext);
}
