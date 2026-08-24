import type { Metadata } from "next";
import "@/lib/fonts";
import "./globals.css";
import { Providers } from "@/components/providers";
import { themeInitScript } from "@/lib/theme-init-script";

export const metadata: Metadata = {
  title: "LedgeIndex | Answers from your docs, not guesses",
  description:
    "Turn product docs into an assistant people trust. Users get clear answers with links back to the source. Support handles fewer repeat questions.",
  metadataBase: new URL("https://ledgeindex.com"),
  alternates: {
    canonical: "https://ledgeindex.com",
  },
  openGraph: {
    title: "LedgeIndex | Answers from your docs, not guesses",
    description:
      "Ask your docs. Get answers with sources. Local or cloud — docs and code.",
    url: "https://ledgeindex.com",
    siteName: "LedgeIndex",
    images: [
      {
        url: "/images/og-banner.webp",
        width: 1200,
        height: 630,
        alt: "LedgeIndex — Ask your docs. Get answers with sources.",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LedgeIndex | Answers from your docs, not guesses",
    description:
      "Ask your docs. Get answers with sources. Local or cloud — docs and code.",
    images: ["/images/og-banner.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full scroll-smooth antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className="min-h-full flex flex-col bg-background text-foreground"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
