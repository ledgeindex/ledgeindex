"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { ChatTestPromptsSheet } from "@/components/chat/chat-test-prompts-sheet";
import { HeaderSelect } from "@/components/ui/header-select";
import { SourceCatalogButton } from "@/components/sources/source-catalog-dialog";
import { useOptionalSourceChatToolbar } from "@/contexts/source-chat-toolbar-context";
import { useAuth } from "@/lib/auth-context";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import {
  DEFAULT_CHAT_RETRIEVAL_STRICTNESS,
  RETRIEVAL_STRICTNESS_OPTIONS,
  resetRetrievalStrictness,
} from "@/lib/retrieval-strictness";
import { cn } from "@/lib/utils";

const SOURCE_CHAT_PATH = /^\/sources\/[^/]+\/chat$/;

export function AppHeaderSourceChatControls() {
  const pathname = usePathname();
  const toolbar = useOptionalSourceChatToolbar();
  const { isAdmin } = useAuth();
  const [testPromptsOpen, setTestPromptsOpen] = useState(false);
  const isDesktop = Boolean(getLedgeIndexDesktop());

  if (!SOURCE_CHAT_PATH.test(pathname) || !toolbar) {
    return null;
  }

  const {
    activeSource,
    testPromptSuggestions,
    submitTestPrompt,
    newChatAvailable,
    requestNewChat,
    retrievalStrictness,
    setRetrievalStrictness,
  } = toolbar;
  const sourceName = activeSource?.sourceName ?? "Chat";
  const sourceId = activeSource?.sourceId;
  const sourceStartUrls = activeSource?.startUrls;
  const canUseTestPrompts =
    (process.env.NODE_ENV === "development" || isAdmin) &&
    testPromptSuggestions.length > 0;

  return (
    <>
      {/* Title cluster — clickable, not draggable */}
      <div
        className={cn(
          "flex min-w-0 shrink items-center gap-2 sm:gap-3",
          isDesktop && "[-webkit-app-region:no-drag]",
        )}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Link
          href="/dashboard"
          className="shrink-0 text-xs text-muted transition-colors hover:text-foreground"
        >
          <span className="sm:hidden">←</span>
          <span className="hidden sm:inline">← Sources</span>
        </Link>
        <h1 className="min-w-0 max-w-[10rem] truncate text-sm font-semibold text-foreground sm:max-w-[16rem] sm:text-base">
          {sourceName}
        </h1>
      </div>

      {/* Flex gap inherits header drag — this is the window move handle */}
      <div className="min-h-full min-w-[1.5rem] flex-1 self-stretch" aria-hidden />

      {/* Actions — clickable (model picker lives in the composer) */}
      <div
        className={cn(
          "ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2",
          isDesktop && "[-webkit-app-region:no-drag]",
        )}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={requestNewChat}
          disabled={!newChatAvailable}
          title="New chat"
          aria-label="New chat"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card-solid text-muted transition-colors",
            "hover:bg-surface-raised hover:text-foreground",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
        </button>
        {canUseTestPrompts ? (
          <button
            type="button"
            onClick={() => setTestPromptsOpen(true)}
            title="Test prompts (dev / admin)"
            aria-haspopup="dialog"
            aria-expanded={testPromptsOpen}
            className={cn(
              "inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card-solid px-[0.45rem]",
              "text-[0.68rem] font-bold tracking-wide text-muted transition-colors",
              "hover:border-foreground/15 hover:bg-surface-raised hover:text-foreground",
              testPromptsOpen && "border-foreground/20 text-foreground",
            )}
          >
            TP
          </button>
        ) : null}
        <HeaderSelect
          ariaLabel="Retrieval strictness"
          value={retrievalStrictness}
          onChange={setRetrievalStrictness}
          options={RETRIEVAL_STRICTNESS_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          className="h-8 max-w-[7.5rem] text-xs"
        />
        {retrievalStrictness !== DEFAULT_CHAT_RETRIEVAL_STRICTNESS ? (
          <button
            type="button"
            onClick={() => setRetrievalStrictness(resetRetrievalStrictness())}
            title="Reset retrieval to default (Strict)"
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-card-solid px-2",
              "text-[0.68rem] font-medium text-muted transition-colors",
              "hover:bg-surface-raised hover:text-foreground",
            )}
          >
            Reset
          </button>
        ) : null}
        {sourceId ? (
          <SourceCatalogButton
            sourceId={sourceId}
            sourceName={sourceName}
            startUrls={sourceStartUrls}
            className="h-8 shrink-0 px-2.5 py-0"
          />
        ) : null}
      </div>

      {canUseTestPrompts ? (
        <ChatTestPromptsSheet
          open={testPromptsOpen}
          onClose={() => setTestPromptsOpen(false)}
          onSelect={submitTestPrompt}
          suggestions={testPromptSuggestions}
        />
      ) : null}
    </>
  );
}
