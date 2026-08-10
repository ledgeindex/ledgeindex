"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DESKTOP_RELEASES_FALLBACK_URL,
  type DesktopReleaseAsset,
} from "@/lib/desktop-release";
import { cn } from "@/lib/utils";

export type DesktopOs = "windows" | "mac" | "other";

export function detectDesktopOs(): DesktopOs {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return "other";
  if (/Windows/i.test(ua) || /Win/i.test(platform)) return "windows";
  if (
    /Mac OS X|Macintosh|MacIntel|MacPPC/i.test(ua) ||
    /Mac/i.test(platform)
  ) {
    return "mac";
  }
  return "other";
}

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M3 5.5 11 4.3v7.2H3V5.5Zm0 13 8 1.3v-7.3H3v6Zm9.2-14.2L21 3v8.5h-8.8V4.3ZM12.2 21 21 22.3V13.5h-8.8V21Z" />
    </svg>
  );
}

function MacIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

type DesktopDownloadButtonsProps = {
  windowsRelease?: DesktopReleaseAsset | null;
  macRelease?: DesktopReleaseAsset | null;
  className?: string;
  trailing?: ReactNode;
};

export function DesktopDownloadButtons({
  windowsRelease = null,
  macRelease = null,
  className,
  trailing,
}: DesktopDownloadButtonsProps) {
  const [os, setOs] = useState<DesktopOs | null>(null);

  useEffect(() => {
    setOs(detectDesktopOs());
  }, []);

  const windowsHref =
    windowsRelease?.downloadUrl ?? DESKTOP_RELEASES_FALLBACK_URL;
  const macHref = macRelease?.downloadUrl ?? DESKTOP_RELEASES_FALLBACK_URL;

  const windowsLabel = windowsRelease
    ? `Download for Windows · v${windowsRelease.version}`
    : "Download for Windows";
  const macLabel = macRelease
    ? `Download for Mac · v${macRelease.version}`
    : "Download for Mac";

  // Avoid flashing both buttons before we know the OS.
  if (os === null) {
    return (
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
          className,
        )}
      >
        <Button
          href={windowsHref}
          className="invisible w-full gap-2 sm:w-auto"
          aria-hidden
          tabIndex={-1}
        >
          <WindowsIcon className="size-3.5 shrink-0" />
          {windowsLabel}
        </Button>
        {trailing}
      </div>
    );
  }

  const preferMac = os === "mac";
  const primaryHref = preferMac ? macHref : windowsHref;
  const primaryLabel = preferMac ? macLabel : windowsLabel;
  const PrimaryIcon = preferMac ? MacIcon : WindowsIcon;
  const otherHref = preferMac ? windowsHref : macHref;
  const otherLabel = preferMac
    ? windowsRelease
      ? `Windows v${windowsRelease.version}`
      : "Windows"
    : macRelease
      ? `Mac v${macRelease.version}`
      : "Mac";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      <Button
        href={primaryHref}
        variant="primary"
        className="w-full gap-2 sm:w-auto"
        rel="noopener noreferrer"
      >
        <PrimaryIcon className="size-3.5 shrink-0" />
        {primaryLabel}
      </Button>
      {trailing}
      <a
        href={otherHref}
        rel="noopener noreferrer"
        className="text-center text-xs text-muted underline-offset-2 hover:text-foreground hover:underline sm:text-left"
      >
        Need {otherLabel} instead?
      </a>
    </div>
  );
}
