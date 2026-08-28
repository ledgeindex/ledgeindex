import {
  DeveloperDocPage,
  developerPageMetadata,
} from "@/components/marketing/developer-doc-page";
import { developerPageByPath } from "@/lib/agent-readiness/developer-content";

const page = developerPageByPath("/developers/api")!;

export const metadata = developerPageMetadata(page);

export default function DevelopersApiPage() {
  return <DeveloperDocPage page={page} />;
}
