"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle-slot";
import { SiteBrand } from "@/components/site-brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { isFirebaseConfigured } from "@/lib/firebase";
import { docsSiteHref } from "@/lib/docs-site-url";
import { cn } from "@/lib/utils";

const DOCS_HREF = docsSiteHref();

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.35.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.1 11.1 0 0 1 5.78 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.25 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.97 15.64Z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

const SOCIAL_LINKS = [
  {
    href: "https://github.com/ledgeindex/ledgeindex",
    label: "GitHub",
    icon: GithubIcon,
  },
  {
    href: "https://discord.gg/gzeKZxsrsP",
    label: "Discord",
    icon: DiscordIcon,
  },
  { href: "https://x.com/LedgeIndex", label: "X", icon: XIcon },
] as const;

export function SiteHeader() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-40">
      {/* floating inset bar at top of page → full-width bar on scroll */}
      <div
        className={cn(
          "transition-all duration-300",
          scrolled ? "p-0" : "px-3 pt-3 sm:px-5",
        )}
      >
        <div
          className={cn(
            "border-border bg-card/85 backdrop-blur-md transition-all duration-300",
            scrolled
              ? "mx-auto max-w-none rounded-none border-b shadow-none"
              : "mx-auto max-w-6xl rounded-2xl border shadow-card",
          )}
        >
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:h-16 sm:gap-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <SiteBrand />
              <span
                aria-hidden
                className="hidden h-5 w-px shrink-0 bg-border sm:block"
              />
              <nav aria-label="Site" className="flex items-center">
                <a
                  href={DOCS_HREF}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground/90 transition-colors hover:bg-surface-raised hover:text-accent"
                >
                  Docs
                </a>
              </nav>
            </div>

            <nav className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              {/* social icons */}
              <div className="hidden items-center gap-0.5 lg:flex">
                {SOCIAL_LINKS.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={social.label}
                    className="flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  >
                    <social.icon className="size-4" aria-hidden />
                  </a>
                ))}
              </div>

              <span
                aria-hidden
                className="hidden h-5 w-px bg-border lg:block"
              />

              <ThemeToggle />
              {isFirebaseConfigured && user ? (
                <Button
                  href="/dashboard"
                  variant="secondary"
                  className="h-9 px-3.5 text-xs sm:text-sm"
                >
                  Open app
                </Button>
              ) : isFirebaseConfigured ? (
                <Button
                  href="/login"
                  variant="secondary"
                  className="h-9 px-3.5 text-xs sm:text-sm"
                >
                  Sign in
                </Button>
              ) : (
                <Button href="#" className="h-9 px-3.5 text-xs sm:px-5 sm:text-sm">
                  <span className="sm:hidden">Demo</span>
                  <span className="hidden sm:inline">Request demo</span>
                </Button>
              )}
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
