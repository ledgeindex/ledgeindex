"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Layers } from "lucide-react";
import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";

type PlanBillingContextValue = {
  planLimitsEnabled: boolean;
  openUpgradeModal: (options?: { title?: string; description?: string }) => void;
  showPlanLimit: (message: string) => void;
};

const PlanBillingContext = createContext<PlanBillingContextValue | null>(null);

export function PlanBillingProvider({ children }: { children: ReactNode }) {
  const { planLimitsEnabled } = useAuth();
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeTitle, setUpgradeTitle] = useState<string | undefined>();
  const [upgradeDescription, setUpgradeDescription] = useState<string | undefined>();

  const openUpgradeModal = useCallback(
    (options?: { title?: string; description?: string }) => {
      setUpgradeTitle(options?.title);
      setUpgradeDescription(options?.description);
      setUpgradeOpen(true);
    },
    [],
  );

  const showPlanLimit = useCallback((message: string) => {
    setLimitMessage(message);
    setLimitOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      planLimitsEnabled,
      openUpgradeModal,
      showPlanLimit,
    }),
    [planLimitsEnabled, openUpgradeModal, showPlanLimit],
  );

  if (!planLimitsEnabled) {
    return (
      <PlanBillingContext.Provider value={value}>
        {children}
      </PlanBillingContext.Provider>
    );
  }

  return (
    <PlanBillingContext.Provider value={value}>
      {children}

      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
            <Layers className="h-5 w-5 text-amber-500" />
          </div>
          <DialogTitle>Plan limit reached</DialogTitle>
          <DialogDescription className="pt-1">
            {limitMessage}
            <span className="mt-2 block text-muted-foreground">
              Upgrade to Pro for unlimited source sets and sources.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setLimitOpen(false)}>
            Not now
          </Button>
          <Button
            onClick={() => {
              setLimitOpen(false);
              openUpgradeModal();
            }}
          >
            Upgrade plan
          </Button>
        </DialogFooter>
      </Dialog>

      <UpgradePlanModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title={upgradeTitle}
        description={upgradeDescription}
      />
    </PlanBillingContext.Provider>
  );
}

export function usePlanBilling() {
  const context = useContext(PlanBillingContext);
  if (!context) {
    throw new Error("usePlanBilling must be used within PlanBillingProvider");
  }
  return context;
}

export function usePlanBillingOptional() {
  return useContext(PlanBillingContext);
}
