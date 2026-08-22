"use client";

import { useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import { cn } from "@/lib/utils";
import {
  filterCrawlUrls,
  KnowledgeIndexApiError,
} from "@/lib/ledgeindex-api";
import {
  crawlModelIdForProvider,
  readCrawlProvider,
} from "@/lib/crawl-provider";

export type CrawlUrlFilterItem = {
  url: string;
  title?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const SUGGESTIONS = [
  "Deselect page not found / error pages",
  "Keep only API reference pages",
  "Deselect changelog and blog posts",
  "Select pages about authentication",
];

const bubbleClass = cn(
  "fixed bottom-4 right-4 z-40 inline-flex size-11 cursor-pointer items-center justify-center",
  "rounded-full border border-border bg-card-solid/95 text-foreground shadow-card backdrop-blur-md",
  "transition-[box-shadow,transform] duration-150 hover:shadow-lg",
);

const panelClass = cn(
  "fixed bottom-4 right-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden",
  "rounded-2xl border border-border bg-card-solid/95 shadow-card backdrop-blur-md",
);

type CrawlUrlFilterAssistantProps = {
  urls: CrawlUrlFilterItem[];
  selectedUrls: string[];
  onSelectionChange: (urls: string[]) => void;
  disabled?: boolean;
};

export function CrawlUrlFilterAssistant({
  urls,
  selectedUrls,
  onSelectionChange,
  disabled = false,
}: CrawlUrlFilterAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Tell me what to keep or remove. I use the numbered URL list and update your checkboxes.",
    },
  ]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (urls.length === 0) return null;

  const showSuggestions = !messages.some((message) => message.role === "user");

  async function submitPrompt(rawPrompt: string) {
    const prompt = rawPrompt.trim();
    if (!prompt || loading || disabled) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const history = messages
        .filter((message) => message.id !== "welcome")
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));

      const selectedIndexes = urls
        .map((item, index) => (selectedUrls.includes(item.url) ? index : -1))
        .filter((index) => index >= 0);

      const crawlProvider = readCrawlProvider();
      const result = await filterCrawlUrls({
        message: prompt,
        urls: urls.map((item, index) => ({
          index,
          url: item.url,
          ...(item.title?.trim() ? { title: item.title.trim() } : {}),
        })),
        selectedIndexes,
        history,
        ...(crawlProvider
          ? { modelId: crawlModelIdForProvider(crawlProvider) }
          : {}),
      });

      const nextSelected = result.selectedIndexes
        .map((index) => urls[index]?.url)
        .filter((url): url is string => Boolean(url));

      onSelectionChange(nextSelected);

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `${result.summary} (${nextSelected.length}/${urls.length} selected)`,
        },
      ]);

      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    } catch (err) {
      const message =
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Could not filter URLs. Try again.";
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: message,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function openPanel() {
    setOpen(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        disabled={disabled}
        className={cn(bubbleClass, disabled && "cursor-not-allowed opacity-50")}
        aria-label="Open URL filter assistant"
        title="Filter URLs with AI"
      >
        <MessageSquare className="size-4" />
      </button>
    );
  }

  return (
    <div className={panelClass}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface-raised">
            <MessageSquare className="size-3.5 text-muted" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              URL filter assistant
            </p>
            <p className="truncate font-mono text-[0.5rem] tracking-[0.08em] text-muted uppercase">
              Gemini 3.1 Flash Lite
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label="Close assistant"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="max-h-56 space-y-2 overflow-y-auto px-3 py-3"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "rounded-lg px-2.5 py-2 text-[0.75rem] leading-5",
              message.role === "user"
                ? "ml-6 bg-foreground text-background"
                : "mr-4 border border-border bg-surface-raised text-muted-strong",
            )}
          >
            {message.content}
          </div>
        ))}
        {loading ? (
          <div className="mr-4 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-[0.75rem] text-muted">
            <Loader className="size-3" />
            Updating selection…
          </div>
        ) : null}
      </div>

      {showSuggestions ? (
      <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={loading || disabled}
            onClick={() => void submitPrompt(suggestion)}
            className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase transition-colors hover:text-foreground disabled:opacity-40"
          >
            {suggestion}
          </button>
        ))}
      </div>
      ) : null}

      <form
        className="border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt(input);
        }}
      >
        {error ? (
          <p className="mb-2 px-1 text-[0.6875rem] text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={2}
            disabled={loading || disabled}
            placeholder="e.g. only keep /docs/api pages"
            className="field-input min-h-[2.75rem] flex-1 resize-none font-mono text-xs leading-5"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitPrompt(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={loading || disabled || !input.trim()}
            className="inline-flex h-9 shrink-0 items-center rounded-md border border-foreground/15 bg-foreground px-3 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-background uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
