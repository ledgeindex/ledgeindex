import {
  DeveloperDocPage,
  developerPageMetadata,
} from "@/components/marketing/developer-doc-page";
import { developerPageByPath } from "@/lib/agent-readiness/developer-content";

const page = developerPageByPath("/developers/cli")!;

export const metadata = developerPageMetadata(page);

export default function DevelopersCliPage() {
  return <DeveloperDocPage page={page} />;
}
