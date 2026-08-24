import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Container } from "@/components/ui/container";

type TrustPageShellProps = {
  title: string;
  children: React.ReactNode;
};

export function TrustPageShell({ title, children }: TrustPageShellProps) {
  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1 border-b border-border/60">
        <Container className="py-12 sm:py-16">
          <nav className="text-sm text-muted">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">{title}</span>
          </nav>
          {children}
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}
