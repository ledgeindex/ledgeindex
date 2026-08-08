import type { Metadata } from "next";
import "@/lib/fonts";
import "./globals.css";
import { Providers } from "@/components/providers";
import { themeInitScript } from "@/lib/theme-init-script";

export const metadata: Metadata = {
  title: "LedgeIndex | Answers from your docs, not guesses",
  description:
    "Turn product docs into an assistant people trust. Users get clear answers with links back to the source. Support handles fewer repeat questions.",
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
