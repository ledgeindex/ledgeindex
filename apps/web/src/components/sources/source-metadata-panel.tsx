"use client";

import {
  formatConfidence,
  formatDetectedSignal,
  SOURCE_CONTENT_TYPE_LABELS,
  SOURCE_CONTENT_TYPES,
  SOURCE_ORIGIN_LABELS,
  SOURCE_ORIGINS,
  type SourceContentType,
  type SourceMetadata,
  type SourceOrigin,
} from "@/lib/source-metadata";

export function SourceMetadataPanel({
  metadata,
  loading = false,
  onChange,
}: {
  metadata: SourceMetadata | null;
  loading?: boolean;
  onChange: (metadata: SourceMetadata) => void;
}) {
  if (loading) {
    return (
      <div className="border-t border-border px-3 py-3 sm:px-4">
        <p className="font-mono text-[0.5625rem] tracking-[0.12em] text-muted uppercase">
          Detecting source metadata…
        </p>
      </div>
    );
  }

  if (!metadata) return null;

  function update(partial: Partial<SourceMetadata>) {
    onChange({ ...metadata!, ...partial });
  }

  return (
    <div className="border-t border-border px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Source metadata
        </p>
        <span className="rounded-md border border-accent/25 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase">
          {formatConfidence(metadata.sourceTypeConfidence)} match
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[0.5rem] tracking-[0.1em] text-muted uppercase">
            Type
          </span>
          <select
            value={metadata.sourceType}
            onChange={(event) =>
              update({
                sourceType: event.target.value as SourceContentType,
                sourceTypeConfidence: 1,
              })
            }
            className="h-8 rounded-md border border-border bg-surface-raised px-2 text-xs text-foreground"
          >
            {SOURCE_CONTENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {SOURCE_CONTENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[0.5rem] tracking-[0.1em] text-muted uppercase">
            Origin
          </span>
          <select
            value={metadata.origin}
            onChange={(event) =>
              update({ origin: event.target.value as SourceOrigin })
            }
            className="h-8 rounded-md border border-border bg-surface-raised px-2 text-xs text-foreground"
          >
            {SOURCE_ORIGINS.map((origin) => (
              <option key={origin} value={origin}>
                {SOURCE_ORIGIN_LABELS[origin]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[0.5rem] tracking-[0.1em] text-muted uppercase">
            Version
          </span>
          <input
            value={metadata.version ?? ""}
            onChange={(event) =>
              update({
                version: event.target.value.trim() || null,
                versionSource: event.target.value.trim() ? "user" : null,
              })
            }
            placeholder="e.g. v3"
            className="h-8 rounded-md border border-border bg-surface-raised px-2 text-xs text-foreground placeholder:text-muted/70"
          />
        </label>
      </div>

      {metadata.detectedSignals.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {metadata.detectedSignals.map((signal) => (
            <span
              key={signal}
              className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-emerald-700 uppercase dark:text-emerald-400"
              title={signal}
            >
              {formatDetectedSignal(signal)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
