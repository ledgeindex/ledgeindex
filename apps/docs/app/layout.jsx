import { Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { DocsNavbarBrand } from "../components/DocsNavbarBrand";
import { DocsNavbarAskAi } from "../components/DocsNavbarAskAi";
import { DocsNavbarThemeSwitch } from "../components/DocsNavbarThemeSwitch";
import { SectionProvider } from "../components/SectionProvider";
import { docsHeadTheme } from "../lib/docs-theme";
import {
  docsWidgetEnabled,
  readDocsWidgetConfig,
} from "../lib/docs-widget-config";
import "nextra-theme-docs/style.css";
import "./globals.css";

const docsDescription =
  "Guides for LedgeIndex packages and apps — crawl, index, retrieve, chat, MCP, web, and desktop.";

export const metadata = {
  metadataBase: new URL("https://ledgeindex.com"),
  title: {
    default: "LedgeIndex Docs",
    template: "%s — LedgeIndex Docs",
  },
  description: docsDescription,
  openGraph: {
    title: "LedgeIndex Documentation",
    description: docsDescription,
    url: "https://ledgeindex.com/docs",
    siteName: "LedgeIndex Docs",
    images: [
      {
        url: "/images/og-docs-banner.webp",
        width: 1200,
        height: 630,
        alt: "LedgeIndex Documentation — guides for packages, apps, and APIs.",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LedgeIndex Documentation",
    description: docsDescription,
    images: ["/images/og-docs-banner.webp"],
  },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
  },
};

const navbar = (
  <Navbar
    className="docs-navbar"
    logo={<DocsNavbarBrand />}
    logoLink={false}
    projectLink="https://github.com/ledgeindex/ledgeindex"
    chatLink="https://discord.gg/gzeKZxsrsP"
  >
    <DocsNavbarThemeSwitch />
  </Navbar>
);
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
  const widget = docsWidgetEnabled() ? readDocsWidgetConfig() : null;

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head
        color={docsHeadTheme.color}
        backgroundColor={docsHeadTheme.backgroundColor}
      />
      <body suppressHydrationWarning>
        <SectionProvider>
          <Layout
            navbar={navbar}
            pageMap={sidebarPageMap(await getPageMap())}
            docsRepositoryBase="https://github.com/ledgeindex/ledgeindex/tree/main/ledgeindex/apps/docs"
            footer={footer}
            nextThemes={{
              defaultTheme: "light",
              disableTransitionOnChange: true,
            }}
            sidebar={{
              autoCollapse: true,
              defaultMenuCollapseLevel: 1,
            }}
          >
            {children}
          </Layout>
        </SectionProvider>
        <DocsNavbarAskAi />
        {widget ? (
          <script
            async
            src={widget.scriptSrc}
            data-website-id={widget.websiteId}
            data-api-base-url={widget.apiBaseUrl}
            data-project-name="Ask AI"
            data-project-color={widget.projectColor}
            data-mode="drawer"
            data-launcher="hidden"
            data-launcher-selector="[data-docs-ask-ai]"
            data-drawer-width="400"
          />
        ) : null}
      </body>
    </html>
  );
}
