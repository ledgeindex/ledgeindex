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

const SOCIAL_LINKS = [
  { href: "https://github.com", label: "GitHub", icon: GithubIcon },
  { href: "https://x.com", label: "X", icon: XIcon },
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
            <div className="flex min-w-0 items-center gap-4 sm:gap-6">
              <SiteBrand />
              <a
                href={DOCS_HREF}
                className="text-sm text-muted transition-colors hover:text-foreground"
              >
                Docs
              </a>
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
