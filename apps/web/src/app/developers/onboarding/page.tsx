import {
  DeveloperDocPage,
  developerPageMetadata,
} from "@/components/marketing/developer-doc-page";
import { developerPageByPath } from "@/lib/agent-readiness/developer-content";

const page = developerPageByPath("/developers/onboarding")!;

export const metadata = developerPageMetadata(page);

export default function DevelopersOnboardingPage() {
  return <DeveloperDocPage page={page} />;
}
