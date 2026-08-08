"use client";

import { cn } from "@/lib/utils";
import type { ChatStatus, FileUIPart } from "ai";
import {
  type ComponentProps,
  type FormEvent,
  type FormEventHandler,
  type KeyboardEventHandler,
  useState,
} from "react";

export type PromptInputMessage = {
  text: string;
  files?: FileUIPart[];
};

export type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  onSubmit?: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void;
};

export function PromptInput({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps) {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const text = String(formData.get("message") ?? "");
    onSubmit?.({ text }, event);
  };

  return (
    <form
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm",
        className,
      )}
      onSubmit={handleSubmit}
      {...props}
    >
      {children}
    </form>
  );
}

export function PromptInputBody({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn("px-3 pt-3", className)} {...props} />;
}

export function PromptInputTextarea({
  className,
  placeholder = "Ask a question…",
  onChange,
  onKeyDown,
  ...props
}: ComponentProps<"textarea">) {
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Enter") {
      if (isComposing || event.nativeEvent.isComposing) return;
      if (event.shiftKey) return;
      event.preventDefault();

      const form = event.currentTarget.form;
      const submitButton = form?.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement | null;
      if (submitButton?.disabled) return;

      form?.requestSubmit();
    }
  };

  return (
    <textarea
      name="message"
      rows={1}
      placeholder={placeholder}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onChange={onChange}
      className={cn(
        "field-sizing-content max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-t border-border/60 px-2 py-2",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputTools({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2", className)} {...props} />
  );
}

export type PromptInputSubmitProps = ComponentProps<"button"> & {
  status?: ChatStatus;
};

export function PromptInputSubmit({
  className,
  status,
  disabled,
  children,
  ...props
}: PromptInputSubmitProps) {
  const busy = status === "submitted" || status === "streaming";

  return (
    <button
      type="submit"
      aria-label={busy ? "Waiting for response" : "Send message"}
      disabled={disabled || busy}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity",
        "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children ??
        (busy ? (
          <svg
            viewBox="0 0 16 16"
            width={16}
            height={16}
            aria-hidden
            className="animate-spin motion-reduce:animate-none"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="M8 1.5a6.5 6.5 0 1 1-4.6 11.1" opacity="0.35" />
            <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 16 16"
            width={16}
            height={16}
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        ))}
    </button>
  );
}
