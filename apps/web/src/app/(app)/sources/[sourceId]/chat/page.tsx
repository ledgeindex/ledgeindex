"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SourceChat } from "@/components/sources/source-chat";
import { useSourceChatToolbar } from "@/contexts/source-chat-toolbar-context";
import { DASHBOARD_SCOPE_STORAGE_KEY } from "@/contexts/dashboard-toolbar-context";
import { syncApiBaseForHosting, syncDesktopApiBaseForScope } from "@/lib/desktop-api-routing";
import { getSource } from "@/lib/ledgeindex-api";
import { resolveSourceHosting } from "@/lib/rerank-backend";

export default function SourceChatPage() {
  const params = useParams<{ sourceId: string }>();
  const sourceId = params.sourceId;
  const { setActiveSource } = useSourceChatToolbar();
  const [sourceName, setSourceName] = useState("Chat");
  const [startUrls, setStartUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const storedScope =
          typeof window !== "undefined" &&
          window.localStorage.getItem(DASHBOARD_SCOPE_STORAGE_KEY) === "global"
            ? "global"
            : "personal";
        syncDesktopApiBaseForScope(storedScope);

        const { source } = await getSource(sourceId);
        if (cancelled) return;
        const scope =
          (source.scope ?? "personal") === "global" ? "global" : "personal";
        const hosting = resolveSourceHosting({
          hosting: source.hosting,
          scope,
        });
        syncApiBaseForHosting({ scope, hosting });
        setSourceName(source.name);
        setStartUrls(source.config.startUrls ?? []);
        setActiveSource({
          sourceId,
          sourceName: source.name,
          scope,
          hosting,
        });
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load set");
          setReady(true);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sourceId, setActiveSource]);

  useEffect(() => {
    return () => setActiveSource(null);
  }, [setActiveSource]);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-6 sm:px-6">
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
      ) : ready ? (
        <SourceChat
          sourceId={sourceId}
          sourceName={sourceName}
          startUrls={startUrls}
        />
      ) : null}
    </div>
  );
}
