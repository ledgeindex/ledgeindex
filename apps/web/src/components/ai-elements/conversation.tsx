"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export function Conversation({ className, ...props }: ConversationProps) {
  return (
    <StickToBottom
      className={cn(
        // Root must stay overflow-hidden — only the inner scroll pane scrolls.
        "chat-conversation-scroll relative min-h-0 min-w-0 flex-1 overflow-hidden",
        className,
      )}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

export type ConversationContentProps = {
  className?: string;
  children?: ReactNode;
};

/**
 * Single chat scroller. Wired manually so we skip StickToBottom.Content's
 * inline `scrollbar-gutter: both-edges` (and avoid a nested overflow pane).
 */
export function ConversationContent({
  className,
  children,
}: ConversationContentProps) {
  const { scrollRef, contentRef } = useStickToBottomContext();

  return (
    <div
      ref={scrollRef}
      className="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable] [scrollbar-width:thin]"
    >
      <div
        ref={contentRef}
        className={cn(
          "flex w-full min-w-0 max-w-full flex-col gap-6 p-4",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
};

export function ConversationEmptyState({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  children,
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-start gap-2 py-2 text-left",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {description ? (
            <p className="text-sm text-muted">{description}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export function ConversationScrollButton({
  className,
  ...props
}: ConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      className={cn(
        "absolute bottom-4 left-1/2 z-10 size-9 -translate-x-1/2 rounded-full p-0",
        className
      )}
      onClick={handleScrollToBottom}
      {...props}
    >
      <span aria-hidden>↓</span>
      <span className="sr-only">Scroll to bottom</span>
    </Button>
  );
}

export function ConversationFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <footer
      className={cn(
        "z-10 shrink-0 border-t border-border bg-card-solid p-3",
        className
      )}
    >
      {children}
    </footer>
  );
}
