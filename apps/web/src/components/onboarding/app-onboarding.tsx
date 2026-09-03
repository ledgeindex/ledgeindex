"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DesktopTitleBar } from "@/components/desktop/desktop-titlebar";
import { WidgetOnSiteMock } from "@/components/home/accelerator-section";
import { AgentGroundingVisual } from "@/components/home/agent-grounding-section";
import { AppsShowcase } from "@/components/home/apps-coming-section";
import { HeroChatShowcase } from "@/components/home/hero-chat-showcase";
import { BuilderWorkbench } from "@/components/home/source-builder-section";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import {
  APP_ONBOARDING_STEPS,
  type AppOnboardingStepId,
  hasCompletedAppOnboarding,
  markAppOnboardingComplete,
} from "@/lib/app-onboarding";
import { useLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

/** Scale children to fit the box without clipping (works at high browser zoom). */
function FitScale({
  children,
  width,
  height,
  className,
}: {
  children: ReactNode;
  width: number;
  height: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      const next = Math.min(1, w / width, h / height);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [width, height]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden",
        className,
      )}
    >
      <div
        className="shrink-0"
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function OnboardingVisual({ stepId }: { stepId: AppOnboardingStepId }) {
  switch (stepId) {
    case "welcome":
      return (
        <FitScale width={420} height={460}>
          <HeroChatShowcase className="h-full w-full max-w-none" />
        </FitScale>
      );
    case "sources":
      return (
        <FitScale width={480} height={360}>
          <div className="h-full w-full">
            <BuilderWorkbench />
          </div>
        </FitScale>
      );
    case "hosting":
      return (
        <FitScale width={420} height={400}>
          <AppsShowcase className="h-full w-full max-w-none" />
        </FitScale>
      );
    case "chat":
      return (
        <FitScale width={480} height={380}>
          <div className="relative h-full w-full">
            <AgentGroundingVisual />
          </div>
        </FitScale>
      );
    case "start":
      return (
        <FitScale width={420} height={320}>
          <div className="h-full w-full">
            <WidgetOnSiteMock />
          </div>
        </FitScale>
      );
    default:
      return null;
  }
}

function AppOnboardingFlow({
  uid,
}: {
  uid: string;
}) {
  const desktop = useLedgeIndexDesktop();
  const [step, setStep] = useState(0);
  const total = APP_ONBOARDING_STEPS.length;
  const current = APP_ONBOARDING_STEPS[step]!;
  const isLast = step === total - 1;

  const finish = useCallback(
    (href: string) => {
      markAppOnboardingComplete(uid);
      // Hard nav: soft router.push can be dropped when the overlay unmounts
      // (especially in Electron), so both CTAs looked like they went nowhere
      // useful / to the same leftover dashboard screen.
      const destination = desktop
        ? window.location.protocol === "file:"
          ? `#${href}`
          : `${window.location.origin}/#${href}`
        : href;
      window.location.assign(destination);
    },
    [desktop, uid],
  );

  return (
    <div
      className={cn(
        "fixed inset-0 z-[300] flex flex-col overflow-hidden bg-background [-webkit-app-region:no-drag]",
        desktop && "pt-9",
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-onboarding-title"
    >
      <DesktopTitleBar />

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 pt-3 sm:px-8 sm:pt-5">
        <div className="flex shrink-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={publicAssetUrl("/images/logo.webp?v=2")}
            alt=""
            width={32}
            height={32}
            className="h-7 w-auto"
            decoding="async"
          />
          <span className="text-base font-medium text-foreground">
            LedgeIndex
          </span>
          <span className="ml-auto text-sm text-muted">
            {step + 1} of {total}
          </span>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-4 lg:mt-4 lg:flex-row lg:items-stretch lg:gap-8">
          <div className="shrink-0 lg:flex lg:w-[min(22rem,38%)] lg:flex-col lg:justify-center">
            <h1
              id="app-onboarding-title"
              className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
            >
              {current.title}
            </h1>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted sm:mt-3 sm:text-base sm:leading-7">
              {current.body}
            </p>
          </div>

          <div
            key={current.id}
            className="min-h-0 flex-1"
            aria-hidden
          >
            <OnboardingVisual stepId={current.id} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pt-4">
          <div
            className="flex gap-1.5"
            aria-label={`Step ${step + 1} of ${total}`}
          >
            {APP_ONBOARDING_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i <= step ? "bg-foreground" : "bg-border",
                )}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2 sm:justify-end">
            {step > 0 ? (
              <Button
                variant="secondary"
                className="h-11 flex-1 rounded-lg px-5 sm:flex-none sm:min-w-[7rem]"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Back
              </Button>
            ) : null}
            {isLast ? (
              <>
                <Button
                  variant="secondary"
                  className="h-11 flex-1 rounded-lg px-5 sm:flex-none sm:min-w-[8rem]"
                  onClick={() => finish("/chat")}
                >
                  Playground
                </Button>
                <Button
                  className="h-11 flex-1 rounded-lg px-5 sm:flex-none sm:min-w-[9rem]"
                  onClick={() => finish("/sources/web-crawl?fresh=1")}
                >
                  Add source
                </Button>
              </>
            ) : (
              <Button
                className={cn(
                  "h-11 rounded-lg px-5",
                  step === 0
                    ? "w-full sm:w-auto sm:min-w-[9rem]"
                    : "flex-1 sm:flex-none sm:min-w-[9rem]",
                )}
                onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Full-screen first-run tour for web + desktop after auth.
 * Must complete the last step — no skip.
 */
export function AppOnboardingGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const [needed, setNeeded] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    if (loading) return;
    if (!user) {
      setNeeded(false);
      return;
    }
    setNeeded(!hasCompletedAppOnboarding(user.uid));
  }, [user, loading]);

  if (needed === null || loading) {
    return <>{children}</>;
  }

  if (needed && user) {
    return <AppOnboardingFlow uid={user.uid} />;
  }

  return <>{children}</>;
}
