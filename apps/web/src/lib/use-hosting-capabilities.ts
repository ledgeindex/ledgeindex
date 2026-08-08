"use client";

import { useEffect, useState } from "react";
import { getLedgeIndexApiBaseUrl } from "@ledgeindex/client";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";

type HostingCapabilities = {
  localAvailable: boolean;
  cloudAvailable: boolean;
  default: "local" | "cloud";
};

const FALLBACK: HostingCapabilities = {
  localAvailable: true,
  cloudAvailable: true,
  default: "local",
};

/**
 * Whether this UI can offer Local indexes (dev / self-host / desktop).
 * Production cloud API reports localAvailable=false.
 */
export function useHostingCapabilities(): HostingCapabilities & {
  ready: boolean;
} {
  const [caps, setCaps] = useState<HostingCapabilities>(FALLBACK);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const desktop = Boolean(getLedgeIndexDesktop());

    async function load() {
      try {
        const res = await fetch(`${getLedgeIndexApiBaseUrl()}/health`);
        if (!res.ok) throw new Error("health failed");
        const json = (await res.json()) as {
          hosting?: Partial<HostingCapabilities>;
        };
        if (cancelled) return;
        setCaps({
          localAvailable: Boolean(json.hosting?.localAvailable) || desktop,
          cloudAvailable: json.hosting?.cloudAvailable !== false,
          default: json.hosting?.default === "cloud" ? "cloud" : "local",
        });
      } catch {
        if (!cancelled) {
          // Localhost / desktop: assume local is available when health is down.
          const host =
            typeof window !== "undefined" ? window.location.hostname : "";
          const looksLocal =
            desktop || host === "localhost" || host === "127.0.0.1";
          setCaps({
            localAvailable: looksLocal,
            cloudAvailable: true,
            default: looksLocal ? "local" : "cloud",
          });
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...caps, ready };
}
