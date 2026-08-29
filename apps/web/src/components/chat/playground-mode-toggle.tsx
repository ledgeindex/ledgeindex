"use client";

import { Bot, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlaygroundMode = "retrieval" | "agent";

export function PlaygroundModeToggle({
  value,
  onChange,
  agentEnabled,
  disabled = false,
}: {
  value: PlaygroundMode;
  onChange: (mode: PlaygroundMode) => void;
  agentEnabled: boolean;
  disabled?: boolean;
}) {
  const options = [
    {
      id: "retrieval" as const,
      label: "Retrieval",
      title: "Answer with the standard retrieval pipeline",
      icon: Search,
      enabled: true,
    },
    {
      id: "agent" as const,
      label: "Agent",
      title: agentEnabled
        ? "Explore the selected local sources with read-only file tools"
        : "Agent mode requires personal sources stored on this device",
      icon: Bot,
      enabled: agentEnabled,
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="Playground mode"
      className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface-raised/80 p-0.5"
    >
      {options.map((option) => {
        const active = value === option.id;
        const optionDisabled = disabled || !option.enabled;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={optionDisabled}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
              active
                ? "bg-card-solid text-foreground shadow-card"
                : "text-muted hover:bg-surface-raised hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-45",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
