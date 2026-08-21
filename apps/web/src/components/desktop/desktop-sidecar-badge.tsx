"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useLedgeIndexDesktop,
  type SidecarHealth,
  type SidecarStatus,
} from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

const DEFAULT_HEALTH: SidecarHealth = {
  status: "idle",
  managedStatus: "idle",
  reachable: false,
  origin: "http://127.0.0.1:3015",
  port: 3015,
};

function labelFor(status: SidecarStatus): string {
  switch (status) {
    case "ready":
      return "On";
    case "extracting":
    case "starting":
      return "Starting";
    case "error":
      return "Error";
    default:
      return "Off";
  }
}

function detailFor(health: SidecarHealth): string {
  switch (health.status) {
    case "ready":
      return "Running in a worker thread on loopback — UI and MCP use the URL below.";
    case "extracting":
    case "starting":
      return "Desktop server is starting. First boot can take a bit while packages load.";
    case "error":
      return health.lastError
        ? health.lastError
        : "Desktop server failed to start or stopped. Try restarting it.";
    default:
      return "Local API is off. Click Start or wait for launch.";
  }
}

function StatusDot({
  tone,
}: {
  tone: "muted" | "on" | "starting" | "error";
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-muted opacity-55",
        tone === "on" && "bg-foreground opacity-100",
        tone === "starting" && "animate-pulse bg-muted-strong opacity-100",
        tone === "error" && "bg-red-500 opacity-100",
      )}
      aria-hidden
    />
  );
}

/** Compact On badge — opens a status popover (port + restart), like AutomationGhost. */
export function DesktopSidecarBadge(): React.JSX.Element | null {
  const desktop = useLedgeIndexDesktop();
  const [health, setHealth] = useState<SidecarHealth>(DEFAULT_HEALTH);
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [starting, setStarting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!desktop?.getSidecarHealth) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const next = await desktop.getSidecarHealth!();
        if (cancelled) return;
        setHealth(next);
        const delay =
          next.status === "extracting" || next.status === "starting"
            ? 750
            : next.status === "ready"
              ? 8_000
              : 4_000;
        timer = setTimeout(() => {
          void poll();
        }, delay);
      } catch {
        if (cancelled) return;
        timer = setTimeout(() => {
          void poll();
        }, 6_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [desktop]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onRestart = useCallback(async () => {
    if (!desktop?.restartSidecar || restarting) return;
    setRestarting(true);
    try {
      const next = await desktop.restartSidecar();
      setHealth(next);
    } finally {
      setRestarting(false);
    }
  }, [desktop, restarting]);

  const onStart = useCallback(async () => {
    if (!desktop?.startSidecar || starting) return;
    setStarting(true);
    try {
      const next = await desktop.startSidecar();
      setHealth(next);
    } finally {
      setStarting(false);
    }
  }, [desktop, starting]);

  if (!desktop?.getSidecarHealth) return null;

  const tone =
    health.status === "ready"
      ? "on"
      : health.status === "starting" || health.status === "extracting"
        ? "starting"
        : health.status === "error"
          ? "error"
          : "muted";

  const label = restarting || starting ? "Starting" : labelFor(health.status);
  const badgeTone = restarting || starting ? "starting" : tone;
  const canStart =
    health.status === "idle" || health.status === "error";
  const busy =
    restarting ||
    starting ||
    health.status === "starting" ||
    health.status === "extracting";

  return (
    <div className="relative [-webkit-app-region:no-drag]" ref={rootRef}>
      <button
        type="button"
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border",
          "bg-card-solid/90 px-2.5 text-[0.68rem] font-semibold tracking-[0.02em]",
          "text-muted backdrop-blur-sm transition-colors",
          "hover:border-foreground/15 hover:text-foreground",
          health.status === "ready" && "text-foreground",
          (health.status === "starting" || health.status === "extracting") &&
            "text-muted-strong",
          health.status === "error" && "text-red-600 dark:text-red-400",
        )}
        title="Server status"
        aria-label={`Server ${label}. Open status.`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <StatusDot tone={badgeTone} />
        <span className="whitespace-nowrap leading-none">{label}</span>
      </button>

      {open ? (
        <div
          className={cn(
            "absolute left-0 top-[calc(100%+0.4rem)] z-[60] w-[min(20rem,calc(100vw-2rem))]",
            "rounded-xl border border-border bg-card-solid shadow-lg backdrop-blur-md",
          )}
          role="dialog"
          aria-label="Local API status"
        >
          <div className="space-y-3 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusDot tone={badgeTone} />
                  <p className="m-0 text-[0.78rem] font-semibold text-foreground">
                    Local API
                  </p>
                </div>
                <p className="m-0 mt-0.5 pl-[1.05rem] text-[0.72rem] leading-snug text-muted">
                  {health.setupMessage || detailFor(health)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canStart && desktop.startSidecar ? (
                  <button
                    type="button"
                    className={cn(
                      "cursor-pointer rounded-lg border-0 bg-foreground px-2.5 py-1.5",
                      "text-[0.7rem] font-semibold text-background",
                      "disabled:cursor-not-allowed disabled:opacity-55",
                    )}
                    disabled={busy}
                    onClick={() => void onStart()}
                  >
                    {starting ? "Starting…" : "Start"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "cursor-pointer rounded-lg border-0 bg-foreground px-2.5 py-1.5",
                      "text-[0.7rem] font-semibold text-background",
                      "disabled:cursor-not-allowed disabled:opacity-55",
                    )}
                    disabled={busy}
                    onClick={() => void onRestart()}
                  >
                    {restarting ? "Restarting…" : "Restart"}
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    "cursor-pointer rounded-lg border border-border bg-transparent",
                    "px-2.5 py-1.5 text-[0.7rem] font-semibold text-muted",
                    "hover:text-foreground",
                  )}
                  onClick={() => setOpen(false)}
                >
                  Dismiss
                </button>
              </div>
            </div>

            <dl className="m-0 grid gap-1.5 rounded-lg border border-border bg-surface-raised/60 px-2.5 py-2 text-[0.7rem]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="m-0 text-muted">Status</dt>
                <dd className="m-0 font-medium text-foreground">{label}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="m-0 text-muted">Port</dt>
                <dd className="m-0 font-mono text-foreground">{health.port}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="m-0 shrink-0 text-muted">Loopback URL</dt>
                <dd className="m-0 truncate font-mono text-foreground" title={health.origin}>
                  {health.origin}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="m-0 text-muted">Runtime</dt>
                <dd className="m-0 font-medium text-foreground">
                  Worker thread
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
