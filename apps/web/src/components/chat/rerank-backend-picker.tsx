"use client";

import {
  RERANK_BACKENDS,
  type LedgeIndexRerankBackendId,
} from "@/lib/rerank-backend";
import { cn } from "@/lib/utils";

export function RerankBackendPicker({
  backendId,
  onChange,
  className,
}: {
  backendId: LedgeIndexRerankBackendId;
  onChange: (backendId: LedgeIndexRerankBackendId) => void;
  className?: string;
}) {
  const active = RERANK_BACKENDS.find((backend) => backend.id === backendId);

  return (
    <div className={cn("space-y-2", className)}>
      <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
        Rerank backend
      </p>
      <div className="flex flex-wrap gap-2">
        {RERANK_BACKENDS.map((backend) => (
          <button
            key={backend.id}
            type="button"
            onClick={() => onChange(backend.id)}
            title={backend.description}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              backendId === backend.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card-solid text-muted hover:text-foreground",
            )}
          >
            {backend.label}
          </button>
        ))}
      </div>
      {active ? (
        <p className="text-[0.625rem] text-muted">{active.description}</p>
      ) : null}
    </div>
  );
}
