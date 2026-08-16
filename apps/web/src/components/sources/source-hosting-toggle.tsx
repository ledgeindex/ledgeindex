"use client";

import { CloudLocalToggle } from "@/components/chat/cloud-local-toggle";
import { cn } from "@/lib/utils";
import type { SourceHosting } from "@ledgeindex/client";

/** Same Local/Cloud control as chat — shared look for New source hosting. */
export function SourceHostingToggle({
  value,
  onChange,
  className,
  disabled = false,
  size = "default",
}: {
  value: SourceHosting;
  onChange: (value: SourceHosting) => void;
  className?: string;
  disabled?: boolean;
  size?: "default" | "compact";
}) {
  return (
    <CloudLocalToggle
      value={value}
      onChange={onChange}
      disabled={disabled}
      size={size}
      label="Storage"
      ariaLabel="Where the index is stored"
      className={cn(className)}
    />
  );
}
