import { cn } from "@/lib/utils";

type AcceleratorChatPreviewProps = {
  className?: string;
};

export function AcceleratorChatPreview({ className }: AcceleratorChatPreviewProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card-solid shadow-card",
        className,
      )}
      aria-hidden
    >
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-3 py-2.5">
        <span className="size-2 rounded-full bg-accent/80" />
        <span className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Accelerator widget · Live on your index
        </span>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-surface-raised px-3 py-2 text-[0.6875rem] leading-5 text-muted-strong sm:text-xs">
          How do I authenticate with the REST API?
        </div>

        <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2.5">
          <p className="text-[0.6875rem] leading-5 text-foreground sm:text-xs sm:leading-5">
            Use a bearer token in the{" "}
            <span className="font-mono text-[0.625rem]">Authorization</span> header.
            Tokens are scoped per workspace and rotate via the dashboard.
          </p>
          <p className="mt-2 font-mono text-[0.5625rem] tracking-wide text-accent uppercase">
            Source · API reference § Authentication
          </p>
        </div>

        <div className="flex gap-1.5 pt-1">
          <span className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] text-muted uppercase">
            Cited
          </span>
          <span className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] text-muted uppercase">
            v2.4 docs
          </span>
        </div>
      </div>
    </div>
  );
}
