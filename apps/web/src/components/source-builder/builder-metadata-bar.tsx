"use client";

import {
  SOURCE_CONTENT_TYPE_LABELS,
  formatDetectedSignal,
  formatConfidence,
  getDisplayDetectedSignals,
  type SourceMetadata,
} from "@/lib/source-metadata";
import { SourceMetadataPanel } from "@/components/sources/source-metadata-panel";
import {
  docsIdentityIsConfigured,
  docsIdentitySummaryText,
} from "@/components/sources/docs-identity-dialog";
import { cn } from "@/lib/utils";

type Props = {
  metadata: SourceMetadata;
  onChange: (metadata: SourceMetadata) => void;
  onAboutClick: () => void;
  aboutBusy?: boolean;
  className?: string;
};

export function BuilderMetadataBar({
  metadata,
  onChange,
  onAboutClick,
  aboutBusy = false,
  className,
}: Props) {
  const hasAbout = docsIdentityIsConfigured(metadata.docsIdentity);
  const aboutSummary = docsIdentitySummaryText(metadata.docsIdentity);
  const displaySignals = getDisplayDetectedSignals(metadata);

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card-solid/70",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <span
            className="rounded-md border border-accent/25 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase"
            title={`${formatConfidence(metadata.sourceTypeConfidence)} match`}
          >
            {SOURCE_CONTENT_TYPE_LABELS[metadata.sourceType]}
          </span>
          {displaySignals.map((signal) => (
            <span
              key={signal}
              className="rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase"
              title={signal}
            >
              {formatDetectedSignal(signal)}
            </span>
          ))}
          {metadata.version ? (
            <span className="rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase">
              {metadata.version}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onAboutClick}
          disabled={aboutBusy}
          className="inline-flex shrink-0 items-center rounded-md border border-border bg-card-solid px-2 py-1 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:border-foreground/15 hover:text-foreground disabled:opacity-50"
        >
          {aboutBusy ? "Preparing…" : hasAbout ? "Edit about" : "About"}
        </button>
      </div>

      {hasAbout ? (
        <div className="border-b border-border px-3 py-2.5 sm:px-4">
          <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
            About
          </p>
          <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-foreground">
            {aboutSummary}
          </p>
        </div>
      ) : null}

      <SourceMetadataPanel metadata={metadata} onChange={onChange} />
    </section>
  );
}
