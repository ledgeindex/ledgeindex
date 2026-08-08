"use client";

import type { ReactNode } from "react";
import { Cloud, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

export function CloudLocalToggle({
  value,
  onChange,
  disabled = false,
  className,
  size = "default",
  ariaLabel = "Retrieval path",
}: {
  value: "cloud" | "local";
  onChange: (value: "cloud" | "local") => void;
  disabled?: boolean;
  className?: string;
  size?: "default" | "compact";
  ariaLabel?: string;
}) {
  const compact = size === "compact";

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 border border-border bg-surface-raised/80 p-0.5",
        compact ? "h-7 rounded-md" : "h-8 rounded-lg",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <ToggleOption
        active={value === "local"}
        disabled={disabled}
        compact={compact}
        label="Local"
        icon={<HardDrive className={compact ? "size-3" : "size-3.5"} aria-hidden />}
        onClick={() => onChange("local")}
      />
      <ToggleOption
        active={value === "cloud"}
        disabled={disabled}
        compact={compact}
        label="Cloud"
        icon={<Cloud className={compact ? "size-3" : "size-3.5"} aria-hidden />}
        onClick={() => onChange("cloud")}
      />
    </div>
  );
}

function ToggleOption({
  active,
  disabled,
  compact,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  compact: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 font-medium transition-colors",
        compact
          ? "h-6 rounded-[0.3rem] px-2 text-[0.6875rem]"
          : "h-7 rounded-md px-2 text-xs",
        active
          ? "bg-card-solid text-foreground shadow-card"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {icon}
      <span className={compact ? "inline" : "hidden sm:inline"}>{label}</span>
    </button>
  );
}
