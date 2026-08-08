"use client";

import type { ReactNode } from "react";
import { Cloud, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

export function CloudLocalToggle({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: "cloud" | "local";
  onChange: (value: "cloud" | "local") => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Retrieval path"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card-solid p-0.5",
        className,
      )}
    >
      <ToggleOption
        active={value === "local"}
        disabled={disabled}
        label="Local"
        icon={<HardDrive className="size-3.5" aria-hidden />}
        onClick={() => onChange("local")}
      />
      <ToggleOption
        active={value === "cloud"}
        disabled={disabled}
        label="Cloud"
        icon={<Cloud className="size-3.5" aria-hidden />}
        onClick={() => onChange("cloud")}
      />
    </div>
  );
}

function ToggleOption({
  active,
  disabled,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
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
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
