"use client";

import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import type { UIMessage } from "ai";
import {
  CitationSourcesProvider,
  streamdownChatComponents,
} from "@/lib/streamdown-chat-components";
import type { CitationSource } from "@/lib/message-citation-sources";
import { streamdownDefaultProps } from "@/lib/streamdown-config";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        "group flex w-full min-w-0 flex-col gap-2",
        from === "user"
          ? "is-user max-w-[85%] ml-auto items-end"
          : "is-assistant max-w-full",
        className,
      )}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({
  children,
  className,
  ...props
}: MessageContentProps) {
  return (
    <div
      className={cn(
        "flex max-w-full min-w-0 flex-col gap-2 text-sm leading-6",
        // overflow-clip (not hidden/auto): round corners without creating a nested scroller
        // and without zeroing flex min-size the way overflow:hidden does.
        "group-[.is-user]:w-fit group-[.is-user]:ml-auto group-[.is-user]:overflow-clip group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-surface-raised group-[.is-user]:px-3 group-[.is-user]:py-2.5",
        "group-[.is-assistant]:w-full group-[.is-assistant]:min-w-0 group-[.is-assistant]:overflow-clip group-[.is-assistant]:rounded-2xl group-[.is-assistant]:rounded-bl-md group-[.is-assistant]:border group-[.is-assistant]:border-border group-[.is-assistant]:bg-background group-[.is-assistant]:px-3 group-[.is-assistant]:py-2.5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  citationSources?: CitationSource[];
};

export const MessageResponse = memo(function MessageResponse({
  className,
  citationSources = [],
  ...props
}: MessageResponseProps) {
  return (
    <CitationSourcesProvider sources={citationSources}>
      <Streamdown
        className={cn(
          // w-full only — size-full (h-full) + overflow-x-hidden makes overflow-y
          // compute to auto and nests a scrollbar inside the message bubble.
          "chat-md w-full min-w-0 max-w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className,
        )}
        components={streamdownChatComponents}
        {...streamdownDefaultProps}
        {...props}
      />
    </CitationSourcesProvider>
  );
});
