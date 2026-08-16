import { Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { DocsNavbarBrand } from "../components/DocsNavbarBrand";
import { SectionProvider } from "../components/SectionProvider";
import { docsHeadTheme } from "../lib/docs-theme";
import "nextra-theme-docs/style.css";
import "./globals.css";

export const metadata = {
  title: {
    default: "LedgeIndex Docs",
    template: "%s — LedgeIndex Docs",
  },
  description:
    "Guides for LedgeIndex packages and apps — crawl, index, retrieve, chat, MCP, web, and desktop.",
};

const navbar = <Navbar logo={<DocsNavbarBrand />} logoLink={false} />;
const footer = null;

const LEGACY_TOP_LEVEL = new Set(["core", "profile", "server"]);

function sidebarPageMap(pageMap) {
  return pageMap.filter((item) => {
    const name = typeof item.name === "string" ? item.name : "";
    const route = typeof item.route === "string" ? item.route : "";
    if (LEGACY_TOP_LEVEL.has(name)) return false;
    if (route === "/core" || route === "/profile" || route === "/server") {
      return false;
    }
    return true;
  });
}

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head
        color={docsHeadTheme.color}
        backgroundColor={docsHeadTheme.backgroundColor}
      />
      <body>
        <SectionProvider>
          <Layout
            navbar={navbar}
            pageMap={sidebarPageMap(await getPageMap())}
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
