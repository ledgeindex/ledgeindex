"use client";

import { useTheme } from "@/components/theme-provider";
import type { ThemePreference } from "@/lib/theme";

const CYCLE: ThemePreference[] = ["light", "dark", "system"];

const THEME_META: Record<
  ThemePreference,
  { label: string; title: string; icon: "sun" | "moon" | "system" }
> = {
  light: { label: "Light", title: "Light theme", icon: "sun" },
  dark: { label: "Dark", title: "Dark theme", icon: "moon" },
  system: { label: "System", title: "System theme", icon: "system" },
};

function nextPreference(current: ThemePreference): ThemePreference {
  const index = CYCLE.indexOf(current);
  return CYCLE[(index + 1) % CYCLE.length] ?? "system";
}

function ThemeIcon({ kind }: { kind: "sun" | "moon" | "system" }) {
  if (kind === "moon") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "system") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M8 20h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 2.5v2M12 19.5v2M4.5 12h2M17.5 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M6.2 17.8l1.4-1.4M16.4 7.6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const { label, title, icon } = THEME_META[preference];
  const next = nextPreference(preference);
  const nextLabel = THEME_META[next].label;

  return (
    <button
      type="button"
      className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-card-solid text-muted shadow-card transition-colors hover:bg-card-raised hover:text-foreground [-webkit-app-region:no-drag]"
      onClick={() => setPreference(next)}
      title={`${title} · click for ${nextLabel}`}
      aria-label={`Theme: ${label}. Switch to ${nextLabel}.`}
    >
      <ThemeIcon kind={icon} />
    </button>
  );
}
