"use client";

import { CloudDailyUsageCard } from "@/components/billing/cloud-daily-usage-card";

export default function UsagePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Usage</h1>
      <CloudDailyUsageCard />
    </div>
  );
}
