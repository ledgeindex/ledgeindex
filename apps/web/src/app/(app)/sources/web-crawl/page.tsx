"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WebCrawlSetup } from "@/components/sources/web-crawl-setup";
import { useAuth } from "@/lib/auth-context";

function WebCrawlPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading, isAdmin } = useAuth();
  const scope = searchParams.get("scope") === "global" ? "global" : "personal";

  useEffect(() => {
    if (loading || scope !== "global" || isAdmin) return;
    router.replace("/sources/web-crawl");
  }, [loading, scope, isAdmin, router]);

  if (loading || (scope === "global" && !isAdmin)) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4 py-8 text-sm text-muted">
        Loading…
      </div>
    );
  }

  return <WebCrawlSetup key={scope} />;
}

export default function WebCrawlSourcePage() {
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-alt">
      <div aria-hidden className="section-glow-cool pointer-events-none absolute inset-0" />
      <Suspense fallback={null}>
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <WebCrawlPageContent />
        </div>
      </Suspense>
    </div>
  );
}
