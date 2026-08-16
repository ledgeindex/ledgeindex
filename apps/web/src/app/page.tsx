import { SiteHeader } from "@/components/site-header";
import { HeroAnnouncementStrip } from "@/components/home/hero-announcement-strip";
import { SiteFooter } from "@/components/site-footer";
import { HeroSection } from "@/components/home/hero-section";
import { CtaSection } from "@/components/home/cta-section";
import { FaqSection } from "@/components/home/faq-section";
import { AcceleratorSection } from "@/components/home/accelerator-section";
import { IndexShowcaseSection } from "@/components/home/index-showcase-section";
import { UseCasesSection } from "@/components/home/use-cases-section";
import { UseCaseFocusSection } from "@/components/home/use-case-focus-section";
import { OpenSourceSection } from "@/components/home/open-source-section";
import { AppsComingSection } from "@/components/home/apps-coming-section";
import { AgentGroundingSection } from "@/components/home/agent-grounding-section";
import { ProfilerSection } from "@/components/home/profiler-section";
import { AskAcrossSection } from "@/components/home/ask-across-section";
import { RegistrySection } from "@/components/home/registry-section";
import { SourceBuilderSection } from "@/components/home/source-builder-section";
import { getLatestDesktopMacRelease, getLatestDesktopWindowsRelease } from "@/lib/desktop-release";

export default async function Home() {
  const [windowsRelease, macRelease] = await Promise.all([
    getLatestDesktopWindowsRelease(),
    getLatestDesktopMacRelease(),
  ]);

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <HeroAnnouncementStrip />
      <SiteHeader />
      <main className="flex-1">
        <HeroSection />
        <RegistrySection />
        <UseCaseFocusSection />
        <IndexShowcaseSection />
        <AgentGroundingSection />
        <SourceBuilderSection />
        <UseCasesSection />
        <AcceleratorSection />
        <ProfilerSection />
        <AskAcrossSection />
        <OpenSourceSection
          windowsRelease={windowsRelease}
          macRelease={macRelease}
        />
        <AppsComingSection
          windowsRelease={windowsRelease}
          macRelease={macRelease}
        />
        <FaqSection />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
