"use client";

import { useState } from "react";
import type { ToolUIPart } from "ai";
import { Loader } from "@/components/ai-elements/loader";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  CircleCheck,
  FileSearch,
  FileText,
  FolderTree,
  Info,
  Search,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";

type SearchChunk = {
  title?: string;
  url?: string;
  score?: number;
  text?: string;
  category?: string;
  section?: string;
};

type SearchAttempt = {
  query?: string;
  insufficient?: boolean;
  chunkCount?: number;
  uniqueChunkCount?: number;
  prunedCount?: number;
};

type SearchToolOutput = {
  insufficient?: boolean;
  question?: string;
  intent?: string;
  plannedBy?: "question" | "agent";
  plannedQueries?: string[];
  searchAttempts?: SearchAttempt[];
  queries?: string[];
  byQuery?: Array<{
    query?: string;
    insufficient?: boolean;
    chunkCount?: number;
    chunks?: SearchChunk[];
  }>;
  chunks?: SearchChunk[];
};

function readQuestion(input: unknown, output: SearchToolOutput): string | undefined {
  if (output.question?.trim()) return output.question.trim();
  if (!input || typeof input !== "object") return undefined;
  const question = (input as Record<string, unknown>).question;
  return typeof question === "string" && question.trim() ? question.trim() : undefined;
}

function readQuery(input: unknown, output: SearchToolOutput): string | undefined {
  if (output.plannedQueries?.[0]?.trim()) return output.plannedQueries[0].trim();
  if (output.byQuery?.[0]?.query?.trim()) return output.byQuery[0].query.trim();
  if (!input || typeof input !== "object") return undefined;
  const query = (input as Record<string, unknown>).query;
  return typeof query === "string" && query.trim() ? query.trim() : undefined;
}

function parseSearchOutput(output: unknown): SearchToolOutput {
  if (!output || typeof output !== "object") return {};
  return output as SearchToolOutput;
}

function resolveToolName(part: ToolUIPart | { type: string; toolName?: string }): string {
  if (part.type === "dynamic-tool" && "toolName" in part) {
    return String(part.toolName ?? "");
  }
  if (part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return part.type;
}

function isDocsSearchTool(name: string): boolean {
  const normalized = name.toLowerCase().replace(/-/g, "");
  return normalized === "docssearch";
}

function toolStatus(
  state: ToolUIPart["state"] | undefined,
): "running" | "complete" | "error" {
  switch (state) {
    case "output-available":
      return "complete";
    case "output-error":
      return "error";
    default:
      return "running";
  }
}

function plannedByLabel(plannedBy?: SearchToolOutput["plannedBy"]): string {
  if (plannedBy === "question") return "user question";
  return plannedBy === "agent" ? "agent query" : "search";
}

function countUniqueUrls(chunks: SearchChunk[]): number {
  return new Set(chunks.map((chunk) => chunk.url).filter(Boolean)).size;
}

function chunkLabel(chunk: SearchChunk, index: number): string {
  return chunk.title?.trim() || chunk.url?.trim() || `Chunk ${index + 1}`;
}

function chunkMeta(chunk: SearchChunk): string {
  const parts: string[] = [];
  if (typeof chunk.score === "number") {
    parts.push(`score ${chunk.score.toFixed(2)}`);
  }
  if (chunk.category?.trim()) {
    parts.push(chunk.category.trim());
  }
  if (chunk.section?.trim()) {
    parts.push(chunk.section.trim());
  }
  const textLen = chunk.text?.trim().length;
  if (textLen) {
    parts.push(`${textLen.toLocaleString()} chars`);
  }
  return parts.join(" · ");
}

function ChunkCard({ chunk, index }: { chunk: SearchChunk; index: number }) {
  const url = chunk.url ?? "";
  const meta = chunkMeta(chunk);
  const text = chunk.text?.trim();

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="min-w-0 font-medium text-foreground">
          {chunkLabel(chunk, index)}
        </p>
        {meta ? (
          <p className="shrink-0 font-mono text-[0.5625rem] text-muted">
            {meta}
          </p>
        ) : null}
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate font-mono text-[0.625rem] text-accent hover:underline"
        >
          {url}
        </a>
      ) : null}
      {text ? (
        <pre className="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap wrap-break-word rounded border border-border/40 bg-muted/20 p-2 font-mono text-[0.625rem] leading-relaxed text-foreground">
          {text}
        </pre>
      ) : (
        <p className="mt-1.5 text-[0.625rem] text-muted italic">
          No chunk text in tool output
        </p>
      )}
    </>
  );
}

function AttemptRow({
  attempt,
  index,
  total,
}: {
  attempt: SearchAttempt;
  index: number;
  total: number;
}) {
  const query = attempt.query?.trim() || `Query ${index + 1}`;
  const rawCount = attempt.chunkCount ?? 0;
  const uniqueCount = attempt.uniqueChunkCount ?? rawCount;
  const failed = attempt.insufficient ?? rawCount === 0;
  const dedupedAway = !failed && uniqueCount < rawCount;
  const label =
    total === 1 ? "Search" : `Query ${index + 1}/${total}`;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-border/40 bg-background/40 px-2 py-1.5">
      <span className="shrink-0 text-[0.5625rem] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[0.625rem] text-foreground">
        {query}
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-[0.5625rem]",
          failed ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {rawCount} chunk{rawCount === 1 ? "" : "s"}
        {failed
          ? " · below threshold"
          : dedupedAway
            ? ` · ${uniqueCount} new (${rawCount} found, merged)`
            : ""}
      </span>
    </div>
  );
}

function isExploreListTool(name: string): boolean {
  const n = name.toLowerCase().replace(/-/g, "_");
  return n === "list_platform_sources" || n === "listplatformsources";
}

function isExploreAskTool(name: string): boolean {
  const n = name.toLowerCase().replace(/-/g, "_");
  return n === "ask_source" || n === "asksource";
}

type WorkspaceToolKind = "read" | "list" | "stat" | "grep" | "search";

const WORKSPACE_TOOL_CONFIG: Record<
  WorkspaceToolKind,
  { title: string; icon: LucideIcon }
> = {
  read: { title: "Read file", icon: FileText },
  list: { title: "List files", icon: FolderTree },
  stat: { title: "Inspect file", icon: Info },
  grep: { title: "Search files", icon: FileSearch },
  search: { title: "Search workspace", icon: Search },
};

function workspaceToolKind(name: string): WorkspaceToolKind | null {
  const normalized = name.toLowerCase().replace(/-/g, "_");
  if (normalized === "mastra_workspace_read_file") return "read";
  if (normalized === "mastra_workspace_list_files") return "list";
  if (normalized === "mastra_workspace_file_stat") return "stat";
  if (normalized === "mastra_workspace_grep") return "grep";
  if (normalized === "mastra_workspace_search") return "search";
  return null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(
  record: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function workspaceToolDetail(
  kind: WorkspaceToolKind,
  input: Record<string, unknown>,
): string {
  const path = stringValue(input, "path", "filePath") ?? "/";
  if (kind === "read" || kind === "list" || kind === "stat") return path;
  const query = stringValue(input, "query", "pattern") ?? "Searching";
  const scope = stringValue(input, "path");
  return scope ? `${query} in ${scope}` : query;
}

function workspaceToolBadge(
  kind: WorkspaceToolKind,
  output: Record<string, unknown>,
): string | null {
  if (kind === "read") {
    const content = stringValue(output, "content", "text");
    return content ? `${content.length.toLocaleString()} chars` : null;
  }

  const arrays =
    kind === "list"
      ? ["entries", "files"]
      : kind === "grep"
        ? ["matches", "results", "hits"]
        : kind === "search"
          ? ["results", "hits"]
          : [];
  for (const key of arrays) {
    const value = output[key];
    if (Array.isArray(value)) {
      return `${value.length} ${kind === "list" ? "items" : "matches"}`;
    }
  }
  return null;
}

function toolOutputPreview(output: unknown): string | null {
  if (typeof output === "string") return output.trim() || null;
  if (!output || typeof output !== "object") return null;
  const record = objectValue(output);
  const content = stringValue(record, "content", "text");
  if (content) return content;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return null;
  }
}

function WorkspaceToolCard({
  part,
  kind,
}: {
  part: ToolUIPart;
  kind: WorkspaceToolKind;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = toolStatus(part.state);
  const input = objectValue(part.input);
  const output = objectValue(part.output);
  const config = WORKSPACE_TOOL_CONFIG[kind];
  const Icon = config.icon;
  const detail = workspaceToolDetail(kind, input);
  const badge = status === "complete" ? workspaceToolBadge(kind, output) : null;
  const preview = toolOutputPreview(part.output);
  const canExpand = status === "complete" && Boolean(preview);

  return (
    <div
      className={cn(
        "group my-0.5 w-full min-w-0 rounded-lg border border-border/50 bg-surface-raised/45 text-xs",
        "dark:border-white/[0.07] dark:bg-[#1A1A1A]",
        status === "error" && "border-red-500/30 bg-red-500/5",
        expanded && canExpand && "rounded-b-none border-b-0",
      )}
    >
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((open) => !open)}
        aria-expanded={canExpand ? expanded : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left",
          canExpand &&
            "cursor-pointer hover:bg-surface-raised/55 dark:hover:bg-white/[0.035]",
          !canExpand && "cursor-default",
        )}
      >
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/45 text-muted-strong dark:border-white/[0.07] dark:bg-white/[0.025]">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 font-medium text-foreground/90">
            {config.title}
          </span>
          <span className="min-w-0 truncate font-mono text-[11px] text-muted" title={detail}>
            {detail}
          </span>
          {status === "error" && part.errorText ? (
            <span className="min-w-0 truncate text-[10px] text-red-600 dark:text-red-300">
              {part.errorText}
            </span>
          ) : null}
        </div>
        {badge ? (
          <span className="shrink-0 rounded border border-border/70 bg-surface-alt px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-strong">
            {badge}
          </span>
        ) : null}
        {status === "running" ? (
          <Loader size={14} className="shrink-0" />
        ) : status === "error" ? (
          <TriangleAlert className="size-3.5 shrink-0 text-red-500" aria-hidden />
        ) : (
          <CircleCheck
            className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
        )}
        {canExpand ? (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        ) : null}
      </button>
      {expanded && preview ? (
        <pre className="max-h-64 overflow-auto rounded-b-lg border border-t-0 border-border/50 bg-background/60 px-3 py-2 whitespace-pre-wrap wrap-break-word font-mono text-[10px] leading-relaxed text-muted-strong dark:border-white/[0.07] dark:bg-black/20">
          {preview}
        </pre>
      ) : null}
    </div>
  );
}

function genericToolLabel(name: string): string {
  return (name || "Tool")
    .replace(/^mastra_workspace_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ExploreToolCard({ part }: { part: ToolUIPart }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = resolveToolName(part);
  const status = toolStatus(part.state);
  const canExpand = status === "complete";
  const output =
    part.output && typeof part.output === "object"
      ? (part.output as Record<string, unknown>)
      : {};
  const input =
    part.input && typeof part.input === "object"
      ? (part.input as Record<string, unknown>)
      : {};

  const isList = isExploreListTool(toolName);
  const title = isList ? "List sources" : "Ask source";
  const items = Array.isArray(output.items) ? output.items : [];
  const hits = Array.isArray(output.hits) ? output.hits : [];
  const message =
    typeof output.message === "string" ? output.message : undefined;
  const sourceLabel =
    (typeof output.sourceName === "string" && output.sourceName) ||
    (typeof output.sourceSlug === "string" && output.sourceSlug) ||
    (typeof input.source === "string" && input.source) ||
    null;
  const question =
    typeof input.question === "string" ? input.question.trim() : "";

  const subtitle = isList
    ? status === "running"
      ? "Listing…"
      : status === "complete"
        ? `${items.length} source${items.length === 1 ? "" : "s"}`
        : null
    : status === "running"
      ? question || "Retrieving…"
      : [sourceLabel, question].filter(Boolean).join(" · ") || null;

  const badge =
    status === "complete" && !isList
      ? output.insufficient
        ? "no hits"
        : `${hits.length} hit${hits.length === 1 ? "" : "s"}`
      : status === "complete" && isList
        ? `${items.length} src`
        : null;

  return (
    <div
      className={cn(
        "group my-0.5 w-full min-w-0 rounded-md border border-border/60 bg-muted/25 text-xs",
        status === "error" && "border-red-500/30 bg-red-500/5",
        expanded && canExpand && "rounded-b-none border-b-0",
      )}
    >
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((open) => !open)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left",
          canExpand && "cursor-pointer hover:bg-muted/45",
          !canExpand && "cursor-default",
          status === "running" && "cursor-wait opacity-90",
        )}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {status === "running" ? (
          <Loader size={14} className="shrink-0" />
        ) : (
          <span
            className={cn(
              "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-[0.5rem]",
              status === "complete"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-red-600",
            )}
            aria-hidden
          >
            {status === "complete" ? "✓" : "!"}
          </span>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 font-medium text-foreground/90">{title}</span>
          {subtitle ? (
            <span className="min-w-0 truncate text-[11px] text-muted">
              {subtitle}
            </span>
          ) : null}
          {status === "error" && part.errorText ? (
            <span className="min-w-0 truncate text-[10px] text-red-600 dark:text-red-300">
              {part.errorText}
            </span>
          ) : null}
        </div>

        {badge ? (
          <span className="shrink-0 rounded border border-border/70 bg-surface-alt px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-strong">
            {badge}
          </span>
        ) : null}

        {canExpand ? (
          <span
            className={cn(
              "shrink-0 text-[0.625rem] text-muted transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          >
            ▾
          </span>
        ) : null}
      </button>

      {expanded && canExpand ? (
        <div className="space-y-1.5 rounded-b-md border border-t-0 border-border/60 bg-muted/15 px-2.5 py-2">
          {message ? (
            <p className="text-[11px] text-muted">{message}</p>
          ) : null}
          {isList
            ? items.map((raw, index) => {
                const item = raw as Record<string, unknown>;
                const name = String(item.name ?? item.slug ?? `Source ${index + 1}`);
                const slug = typeof item.slug === "string" ? item.slug : "";
                const pages =
                  typeof item.pageCount === "number" ? item.pageCount : null;
                const chunks =
                  typeof item.chunkCount === "number" ? item.chunkCount : null;
                return (
                  <div
                    key={`${slug}-${index}`}
                    className="flex min-w-0 items-baseline gap-2 rounded border border-border/40 bg-background/50 px-2 py-1"
                  >
                    <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                      {name}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[10px] text-muted">
                      {slug}
                      {pages != null ? ` · ${pages}p` : ""}
                      {chunks != null ? ` · ${chunks}c` : ""}
                    </span>
                  </div>
                );
              })
            : hits.map((raw, index) => {
                const hit = raw as Record<string, unknown>;
                const hitTitle =
                  (typeof hit.title === "string" && hit.title) ||
                  (typeof hit.url === "string" && hit.url) ||
                  `Hit ${index + 1}`;
                const url = typeof hit.url === "string" ? hit.url : "";
                const text = typeof hit.text === "string" ? hit.text : "";
                const score =
                  typeof hit.score === "number" ? hit.score.toFixed(2) : null;
                return (
                  <div
                    key={`${url}-${index}`}
                    className="rounded border border-border/40 bg-background/50 px-2 py-1.5"
                  >
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className="min-w-0 truncate text-[11px] font-medium text-foreground">
                        {hitTitle}
                      </p>
                      {score ? (
                        <span className="shrink-0 font-mono text-[10px] text-muted">
                          {score}
                        </span>
                      ) : null}
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate font-mono text-[10px] text-accent hover:underline"
                      >
                        {url}
                      </a>
                    ) : null}
                    {text ? (
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-[10px] leading-relaxed text-muted">
                        {text}
                      </pre>
                    ) : null}
                  </div>
                );
              })}
        </div>
      ) : null}
    </div>
  );
}

export function ChatToolResultCard({ part }: { part: ToolUIPart }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = resolveToolName(part);

  if (isExploreListTool(toolName) || isExploreAskTool(toolName)) {
    return <ExploreToolCard part={part} />;
  }

  const workspaceKind = workspaceToolKind(toolName);
  if (workspaceKind) {
    return <WorkspaceToolCard part={part} kind={workspaceKind} />;
  }

  if (!isDocsSearchTool(toolName)) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted">
        <Wrench className="size-3.5 shrink-0" aria-hidden />
        {genericToolLabel(toolName || part.type)}
      </div>
    );
  }

  const status = toolStatus(part.state);
  const output = parseSearchOutput(part.output);
  const question = readQuestion(part.input, output);
  const runningQuery = readQuery(part.input, output);
  const attempts =
    output.searchAttempts && output.searchAttempts.length > 0
      ? output.searchAttempts
      : (output.byQuery ?? []).map((entry) => ({
          query: entry.query,
          insufficient: entry.insufficient,
          chunkCount: entry.chunkCount,
        }));
  const byQuery = output.byQuery ?? [];
  const chunks = output.chunks ?? [];
  const sourceCount = countUniqueUrls(chunks);
  const canExpand = status === "complete";

  const subtitle =
    status === "running"
      ? runningQuery || "Searching…"
      : question || runningQuery || null;
  const badge =
    status === "complete"
      ? output.insufficient
        ? "no hits"
        : `${chunks.length} chunk${chunks.length === 1 ? "" : "s"}${
            sourceCount > 0 ? ` · ${sourceCount}p` : ""
          }`
      : null;

  return (
    <div
      className={cn(
        "group my-0.5 w-full min-w-0 rounded-md border border-border/60 bg-muted/25 text-xs",
        status === "error" && "border-red-500/30 bg-red-500/5",
        expanded && canExpand && "rounded-b-none border-b-0",
      )}
    >
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((open) => !open)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left",
          canExpand && "cursor-pointer hover:bg-muted/45",
          !canExpand && "cursor-default",
          status === "running" && "cursor-wait opacity-90",
        )}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {status === "running" ? (
          <Loader size={14} className="shrink-0" />
        ) : (
          <span
            className={cn(
              "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-[0.5rem]",
              status === "complete"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-red-600",
            )}
            aria-hidden
          >
            {status === "complete" ? "✓" : "!"}
          </span>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 font-medium text-foreground/90">
            Search docs
          </span>
          {subtitle ? (
            <span className="min-w-0 truncate text-[11px] text-muted">
              {subtitle}
            </span>
          ) : null}
          {status === "error" && part.errorText ? (
            <span className="min-w-0 truncate text-[10px] text-red-600 dark:text-red-300">
              {part.errorText}
            </span>
          ) : null}
        </div>

        {badge ? (
          <span className="shrink-0 rounded border border-border/70 bg-surface-alt px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-strong">
            {badge}
          </span>
        ) : null}

        {canExpand ? (
          <span
            className={cn(
              "shrink-0 text-[0.625rem] text-muted transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          >
            ▾
          </span>
        ) : null}
      </button>

      {expanded && canExpand ? (
        <div className="space-y-2 rounded-b-md border border-t-0 border-border/60 bg-muted/15 px-2.5 py-2">
          {attempts.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Queries
                {output.plannedBy ? ` · ${plannedByLabel(output.plannedBy)}` : ""}
              </p>
              {attempts.map((attempt, index) => (
                <AttemptRow
                  key={`${attempt.query}-${index}`}
                  attempt={attempt}
                  index={index}
                  total={attempts.length}
                />
              ))}
            </div>
          ) : null}

          {byQuery.length > 0
            ? byQuery.map((entry, queryIndex) => {
                const entryChunks = entry.chunks ?? [];
                const query = entry.query?.trim() || `Query ${queryIndex + 1}`;

                return (
                  <section key={`${entry.query}-${queryIndex}`}>
                    <p className="mb-1 font-mono text-[10px] font-medium text-foreground">
                      {query}
                      {entry.insufficient ? " · below threshold" : ""}
                      {typeof entry.chunkCount === "number"
                        ? ` · ${entry.chunkCount} chunk${entry.chunkCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                    {entryChunks.length === 0 ? (
                      <p className="text-[10px] text-muted italic">
                        No chunks kept after rerank + prune
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {entryChunks.map((chunk, index) => (
                          <li
                            key={`${entry.query}-${chunk.url}-${index}`}
                            className="rounded border border-border/40 bg-background/50 p-1.5"
                          >
                            <ChunkCard chunk={chunk} index={index} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })
            : chunks.length > 0 ? (
                <ul className="space-y-1.5">
                  {chunks.map((chunk, index) => (
                    <li
                      key={`${chunk.url}-${index}`}
                      className="rounded border border-border/40 bg-background/50 p-1.5"
                    >
                      <ChunkCard chunk={chunk} index={index} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[10px] text-muted italic">
                  No chunks retrieved — try rephrasing or check the index catalog.
                </p>
              )}
        </div>
      ) : null}
    </div>
  );
}

function isToolPart(part: { type: string }): part is ToolUIPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export { isToolPart, resolveToolName };
