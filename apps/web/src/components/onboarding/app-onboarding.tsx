"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

function OnboardingVisual({ stepId }: { stepId: AppOnboardingStepId }) {
  switch (stepId) {
    case "welcome":
      return (
        <HeroChatShowcase className="mx-auto w-full max-w-sm scale-[0.92] sm:max-w-md sm:scale-100" />
      );
    case "sources":
      return (
        <div className="mx-auto w-full max-w-md sm:max-w-lg">
          <BuilderWorkbench />
        </div>
      );
    case "hosting":
      return (
        <AppsShowcase className="mx-auto w-full max-w-sm scale-[0.92] sm:max-w-md sm:scale-100" />
      );
    case "chat":
      return (
        <div className="relative mx-auto w-full max-w-md sm:max-w-lg">
          <AgentGroundingVisual />
        </div>
      );
    case "start":
      return (
        <div className="mx-auto w-full max-w-sm sm:max-w-md">
          <WidgetOnSiteMock />
        </div>
      );
    default:
      return null;
  }
}

function AppOnboardingFlow({
  uid,
  onComplete,
}: {
  uid: string;
  onComplete: () => void;
}) {
  const router = useRouter();
  const desktop = useLedgeIndexDesktop();
  const [step, setStep] = useState(0);
  const total = APP_ONBOARDING_STEPS.length;
  const current = APP_ONBOARDING_STEPS[step]!;
  const isLast = step === total - 1;

  const finish = useCallback(
    (href?: string) => {
      markAppOnboardingComplete(uid);
      onComplete();
      if (href) router.push(href);
    },
    [uid, onComplete, router],
  );

  return (
    <div
      className={cn(
        "fixed inset-0 z-[300] flex flex-col bg-background [-webkit-app-region:no-drag]",
        desktop && "pt-9",
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-onboarding-title"
    >
      <DesktopTitleBar />

      <div className="flex min-h-0 flex-1 flex-col px-4 py-5 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5">
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

        <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
          <div className="order-2 min-w-0 lg:order-1">
            <h1
              id="app-onboarding-title"
              className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-4xl"
            >
              {current.title}
            </h1>
            <p className="mt-4 max-w-md text-base leading-7 text-muted sm:text-lg sm:leading-8">
              {current.body}
            </p>
          </div>

          <div
            key={current.id}
            className="order-1 flex min-h-[14rem] items-center justify-center lg:order-2"
            aria-hidden
          >
            <OnboardingVisual stepId={current.id} />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
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

          <div className="flex items-center gap-2 sm:justify-end">
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
                  Add a source
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
    return (
      <AppOnboardingFlow
        uid={user.uid}
        onComplete={() => setNeeded(false)}
      />
    );
  }

  return <>{children}</>;
}
