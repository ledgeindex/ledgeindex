import { Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { DocsTabs } from "../components/DocsTabs";
import { SectionProvider } from "../components/SectionProvider";
import "nextra-theme-docs/style.css";
import "./globals.css";

export const metadata = {
  title: {
    default: "LedgeIndex Docs",
    template: "%s — LedgeIndex Docs",
  },
  description:
    "Guides and primitive reference for LedgeIndex — crawl, enrich, chunk, embed, and query documentation for agents.",
};

const navbar = (
  <>
    <Navbar logo={<b>LedgeIndex</b>} />
    <DocsTabs />
  </>
);
const footer = null;

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <SectionProvider>
          <Layout
            navbar={navbar}
            pageMap={await getPageMap()}
            docsRepositoryBase="https://github.com/ledgeindex/ledgeindex/tree/main/ledgeindex/apps/docs"
            footer={footer}
            sidebar={{
              autoCollapse: true,
              defaultMenuCollapseLevel: 1,
            }}
          >
            {children}
          </Layout>
        </SectionProvider>
      </body>
    </html>
  );
}
