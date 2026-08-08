"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import type {
  IngestPipelineNode,
  PipelineNodeStatus,
} from "@/lib/ledgeindex-api";

type PipelineNodeData = {
  label: string;
  status: PipelineNodeStatus;
  detail?: string;
  progress?: {
    current: number;
    total: number;
    phase?: string;
  };
  compact?: boolean;
  strip?: boolean;
  navigable?: boolean;
  navActive?: boolean;
  navDisabled?: boolean;
};

function PipelineProgressBar({
  progress,
  className,
}: {
  progress?: { current: number; total: number };
  className?: string;
}) {
  if (!progress || progress.total <= 0) return null;
  const pct = Math.min(
    100,
    Math.round((progress.current / progress.total) * 100),
  );

  return (
    <span
      className={cn(
        "block overflow-hidden rounded-full bg-border/80",
        className,
      )}
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

function statusColor(status: PipelineNodeStatus) {
  switch (status) {
    case "running":
      return "border-accent/50 bg-accent/10 text-accent";
    case "done":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "suspended":
      return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200";
    case "error":
      return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-card-solid text-muted";
  }
}

function PipelineNode({
  data,
}: NodeProps<Node<PipelineNodeData & { animate?: boolean }>>) {
  const animate = data.animate ?? false;
  return (
    <div
      title={data.strip && data.detail ? data.detail : undefined}
      className={cn(
        "rounded-lg border shadow-card transition-colors duration-300",
        data.strip
          ? "min-w-[5rem] px-2 py-1"
          : data.compact
            ? "min-w-[7.5rem] px-3 py-2"
            : "min-w-[10.5rem] px-4 py-3",
        pipelineNodeMotionClass(data.status, { strip: data.strip, animate }),
        data.navActive &&
          data.status !== "running" &&
          data.status !== "suspended" &&
          "ring-2 ring-foreground/25",
        data.navigable &&
          !data.navDisabled &&
          "cursor-pointer hover:ring-2 hover:ring-foreground/15",
        data.navDisabled && "opacity-50",
        statusColor(data.status),
        animate &&
          data.strip &&
          data.status === "running" &&
          "pipeline-strip-shimmer",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-border !bg-card-solid"
      />
      <p
        className={cn(
          "relative z-[1] font-mono font-semibold tracking-[0.12em] uppercase opacity-90",
          data.strip
            ? "text-[0.5rem] leading-3"
            : data.compact
              ? "text-[0.5625rem]"
              : "text-[0.625rem]",
        )}
      >
        {data.strip ? (
          <PipelineStripLabel
            label={data.label}
            status={data.status}
            animate={animate}
          />
        ) : (
          data.label
        )}
      </p>
      {data.detail && !data.strip ? (
        <p
          className={cn(
            "mt-0.5 leading-4 opacity-95",
            data.compact ? "text-[0.6875rem]" : "text-xs leading-5",
          )}
        >
          {data.detail}
        </p>
      ) : null}
      {data.status === "running" && data.progress ? (
        <PipelineProgressBar
          progress={data.progress}
          className="mt-1.5 h-1 w-full"
        />
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!border-border !bg-card-solid"
      />
    </div>
  );
}

const nodeTypes = { pipeline: PipelineNode };

const NAVIGABLE_STEPS = new Set(["crawl", "extract"]);

function FitViewOnResize({
  containerRef,
  isStrip,
  isLargeBanner,
  compact,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isStrip: boolean;
  isLargeBanner: boolean;
  compact?: boolean;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const fit = () => {
      requestAnimationFrame(() => {
        void fitView({
          padding: isStrip ? 0.02 : isLargeBanner ? 0.12 : compact ? 0.06 : 0.28,
          maxZoom: 1,
          minZoom: isStrip ? 0.25 : isLargeBanner ? 0.95 : compact ? 0.5 : 0.5,
          duration: 0,
        });
      });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, fitView, isStrip, isLargeBanner, compact]);

  return null;
}

function pipelineNodeMotionClass(
  status: PipelineNodeStatus,
  options?: { strip?: boolean; animate?: boolean },
) {
  const { strip, animate = false } = options ?? {};
  if (!animate || status !== "running") return "";

  if (strip) {
    return "ring-2 ring-accent/40 pipeline-node-running pipeline-strip-shimmer";
  }

  return "ring-2 ring-accent/40 shadow-md pipeline-node-running";
}

function PipelineStripConnector({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative h-px w-3 shrink-0 self-center sm:w-5",
        active ? "pipeline-connector-flow bg-accent/25" : "bg-border",
      )}
    />
  );
}

function PipelineStripLabel({
  label,
  status,
  animate,
}: {
  label: string;
  status: PipelineNodeStatus;
  animate: boolean;
}) {
  return (
    <span className="relative z-[1] inline-flex items-center gap-1.5">
      {animate && status === "running" ? (
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
        </span>
      ) : null}
      {status === "done" ? (
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
      ) : null}
      {status === "suspended" ? (
        <span className="size-1.5 shrink-0 rounded-full bg-amber-400/80" />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

function PipelineStrip({
  pipeline,
  activeStepId,
  onStepClick,
  disabledStepIds,
  animate = false,
  align = "center",
}: {
  pipeline: IngestPipelineNode[];
  activeStepId?: string;
  onStepClick?: (stepId: string) => void;
  disabledStepIds?: string[];
  animate?: boolean;
  align?: "center" | "start";
}) {
  const disabled = useMemo(
    () => new Set(disabledStepIds ?? []),
    [disabledStepIds],
  );

  return (
    <div
      role="list"
      aria-label="Ingestion pipeline"
      className={cn(
        "flex h-full w-full min-w-0 items-center gap-1 self-center px-2 sm:gap-1.5 sm:px-3",
        align === "start" ? "justify-start" : "justify-center",
      )}
    >
      {pipeline.map((node, index) => {
        const navigable = Boolean(onStepClick && NAVIGABLE_STEPS.has(node.id));
        const navDisabled = navigable && disabled.has(node.id);
        const isActive = activeStepId === node.id;
        const isRunning = node.status === "running";
        const isSuspended = node.status === "suspended";
        const isAnimating = animate && isRunning;
        const sharedClassName = cn(
          "relative min-w-0 max-w-[8.5rem] truncate rounded-lg border px-2 py-1 font-mono text-[0.5rem] font-semibold tracking-[0.1em] uppercase shadow-card transition-colors sm:max-w-[10rem] sm:px-2.5 sm:text-[0.5625rem]",
          pipelineNodeMotionClass(node.status, { strip: true, animate }),
          isActive && !isRunning && !isSuspended && "ring-2 ring-foreground/25",
          navigable &&
            !navDisabled &&
            "cursor-pointer hover:ring-2 hover:ring-foreground/15",
          navDisabled && "opacity-50",
          statusColor(node.status),
          isRunning &&
            (node.progress || node.detail) &&
            "max-w-[12.5rem] truncate-none sm:max-w-[14rem]",
        );

        const stepTitle =
          node.detail ??
          (node.progress
            ? `${node.label} ${node.progress.current} / ${node.progress.total}`
            : node.label);

        const pathPhase = node.progress?.phase?.trim() || null;

        const stepContent = (
          <>
            <PipelineStripLabel
              label={node.label}
              status={node.status}
              animate={animate}
            />
            {isRunning && pathPhase ? (
              <span className="mt-0.5 truncate text-[0.4375rem] font-normal normal-case tracking-normal opacity-80">
                {pathPhase}
              </span>
            ) : null}
            {isRunning && node.progress ? (
              <>
                <span className="mt-0.5 truncate text-[0.4375rem] font-normal normal-case tracking-normal opacity-80">
                  {node.progress.current}/{node.progress.total}
                </span>
                <PipelineProgressBar
                  progress={node.progress}
                  className="mt-1 h-0.5 w-full"
                />
              </>
            ) : null}
          </>
        );

        return (
          <Fragment key={node.id}>
            {index > 0 ? (
              <PipelineStripConnector active={isAnimating} />
            ) : null}
            {navigable && !navDisabled ? (
              <button
                type="button"
                role="listitem"
                title={stepTitle}
                onClick={() => onStepClick!(node.id)}
                className={cn(sharedClassName, "flex flex-col self-center text-left")}
              >
                {stepContent}
              </button>
            ) : (
              <div
                role="listitem"
                title={stepTitle}
                className={cn(sharedClassName, "flex flex-col self-center")}
              >
                {stepContent}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function IngestPipelineFlowInner({
  pipeline,
  layout,
  compact,
  bannerSize = "default",
  activeStepId,
  onStepClick,
  disabledStepIds,
  animate = false,
}: {
  pipeline: IngestPipelineNode[];
  layout: "horizontal" | "vertical";
  compact?: boolean;
  bannerSize?: "default" | "large" | "strip";
  activeStepId?: string;
  onStepClick?: (stepId: string) => void;
  disabledStepIds?: string[];
  animate?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isHorizontal = layout === "horizontal";
  const isStrip = bannerSize === "strip";
  const isLargeBanner = bannerSize === "large";
  const useCompactNodes = (compact && !isLargeBanner) || isStrip;
  const nodeStride = isStrip ? 108 : isLargeBanner ? 220 : compact ? 148 : isHorizontal ? 200 : 76;
  const disabled = useMemo(
    () => new Set(disabledStepIds ?? []),
    [disabledStepIds],
  );

  const nodes = useMemo<Node<PipelineNodeData>[]>(
    () =>
      pipeline.map((node, index) => {
        const navigable = Boolean(onStepClick && NAVIGABLE_STEPS.has(node.id));
        const navDisabled = navigable && disabled.has(node.id);

        return {
          id: node.id,
          type: "pipeline",
          position: isHorizontal
            ? {
                x: index * nodeStride + (isStrip ? 8 : 16),
                y: isStrip ? 2 : isLargeBanner ? 36 : compact ? 8 : 24,
              }
            : { x: 12, y: index * nodeStride + 8 },
          data: {
            label: node.label,
            status: node.status,
            detail: node.detail,
            progress: node.progress,
            compact: useCompactNodes,
            strip: isStrip,
            navigable,
            navActive: activeStepId === node.id,
            navDisabled,
            animate,
          },
        };
      }),
    [pipeline, isHorizontal, nodeStride, useCompactNodes, isStrip, isLargeBanner, activeStepId, onStepClick, disabled, animate],
  );

  const edges = useMemo(
    () =>
      pipeline.slice(0, -1).map((node, index) => ({
        id: `${node.id}-${pipeline[index + 1]?.id}`,
        source: node.id,
        target: pipeline[index + 1]!.id,
        animated: pipeline[index + 1]?.status === "running",
        style: { stroke: "var(--border)", strokeWidth: 2 },
      })),
    [pipeline],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<PipelineNodeData>) => {
      if (!onStepClick || !NAVIGABLE_STEPS.has(node.id)) return;
      if (node.id === "extract" && node.data.navDisabled) return;
      onStepClick(node.id);
    },
    [onStepClick],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full bg-surface-alt/60",
        isStrip
          ? "min-h-[3.25rem] rounded-md border border-border/60"
          : "rounded-xl border border-border/80",
        !isStrip &&
          (isLargeBanner
            ? "h-[11rem]"
            : compact
              ? "h-[5.25rem]"
              : "h-full min-h-[11rem]"),
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{
          padding: isStrip ? 0.02 : isLargeBanner ? 0.12 : compact ? 0.06 : 0.28,
          maxZoom: 1,
          minZoom: isStrip ? 0.25 : isLargeBanner ? 0.95 : compact ? 0.5 : 0.5,
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling
        proOptions={{ hideAttribution: true }}
      >
        <FitViewOnResize
          containerRef={containerRef}
          isStrip={isStrip}
          isLargeBanner={isLargeBanner}
          compact={compact}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={isStrip ? 10 : 16}
          size={1}
          color="var(--border)"
        />
      </ReactFlow>
    </div>
  );
}

export function IngestPipelineFlow({
  pipeline,
  headline,
  layout = "horizontal",
  variant = "default",
  bannerSize = "default",
  className,
  activeStepId,
  onStepClick,
  disabledStepIds,
  animate = false,
  stripAlign = "center",
}: {
  pipeline: IngestPipelineNode[];
  headline?: string;
  layout?: "horizontal" | "vertical";
  variant?: "default" | "banner";
  bannerSize?: "default" | "large" | "strip";
  className?: string;
  activeStepId?: string;
  onStepClick?: (stepId: string) => void;
  disabledStepIds?: string[];
  animate?: boolean;
  stripAlign?: "center" | "start";
}) {
  const isBanner = variant === "banner";

  if (isBanner) {
    if (bannerSize === "strip") {
      return (
        <div
          className={cn(
            "flex min-h-[3.25rem] w-full min-w-0 items-center rounded-md border border-border/60 bg-surface-alt/60 py-1",
            stripAlign === "start" ? "justify-start" : "justify-center",
            className,
          )}
        >
          <PipelineStrip
            pipeline={pipeline}
            activeStepId={activeStepId}
            onStepClick={onStepClick}
            disabledStepIds={disabledStepIds}
            animate={animate}
            align={stripAlign}
          />
        </div>
      );
    }

    return (
      <div
        className={cn(
          bannerSize === "large" ? "h-[11rem]" : "h-[5.25rem]",
          "min-w-0",
          className,
        )}
      >
        <ReactFlowProvider>
          <IngestPipelineFlowInner
            pipeline={pipeline}
            layout={layout}
            compact
            bannerSize={bannerSize}
            activeStepId={activeStepId}
            onStepClick={onStepClick}
            disabledStepIds={disabledStepIds}
            animate={animate}
          />
        </ReactFlowProvider>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="shrink-0 space-y-1">
        <p className="font-mono text-[0.625rem] font-semibold tracking-[0.14em] text-muted uppercase">
          Ingestion pipeline
        </p>
        {headline ? (
          <p className="text-sm leading-5 text-foreground">{headline}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <IngestPipelineFlowInner
            pipeline={pipeline}
            layout={layout}
            activeStepId={activeStepId}
            onStepClick={onStepClick}
            disabledStepIds={disabledStepIds}
            animate={animate}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
