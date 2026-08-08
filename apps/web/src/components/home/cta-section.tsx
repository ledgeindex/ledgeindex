import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/section-badge";

const ENTERPRISE_POINTS = [
  "Sign-in with your company accounts and access by role",
  "Pay for how much you use, not for seats",
  "Your docs stay yours, ready to export anytime",
] as const;

export function CtaSection() {
  return (
    <section className="relative overflow-hidden bg-surface-alt py-12 sm:py-20 lg:py-24">
      <div aria-hidden className="section-glow-cool pointer-events-none absolute inset-0" />
      <span
        aria-hidden
        className="paper-accent-fade absolute inset-x-0 top-0 h-px"
      />
      <Container className="relative">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          <div className="relative rounded-2xl bg-gradient-to-br from-amber-700/70 via-slate-500 to-stone-400 p-px shadow-card sm:rounded-3xl">
          <div className="relative h-full overflow-hidden rounded-[calc(1rem-1px)] bg-ink px-5 py-8 sm:rounded-[calc(1.5rem-1px)] sm:px-8 sm:py-10 lg:px-10 dark:bg-card-raised">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_80%_0%,rgb(255_255_255/0.06),transparent_70%)] dark:bg-[radial-gradient(ellipse_55%_50%_at_85%_0%,rgb(212_196_168/0.08),transparent_72%)]"
            />
            <div className="relative">
              <Eyebrow className="mb-3 text-ink-muted">For builders</Eyebrow>
              <h2 className="text-xl font-semibold tracking-tight text-ink-foreground sm:text-2xl lg:text-3xl">
                Try it with your docs in minutes.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-ink-muted sm:mt-4 sm:text-base sm:leading-7">
                Paste a docs URL, index it, and put answers where your users
                already get stuck: on the site, in support, or in your own tools.
              </p>
              <p className="mt-5 overflow-x-auto rounded-xl border border-ink-border bg-ink-soft px-3 py-2.5 font-mono text-[0.6875rem] leading-5 whitespace-nowrap text-ink-muted sm:mt-6 sm:px-4 sm:py-3 sm:text-xs sm:leading-6 dark:border-border/80 dark:bg-card-solid">
                <span className="text-ink-foreground/60">$</span>{" "}
                <span className="cta-typewriter align-bottom text-ink-foreground">
                  npx ledgeindex crawl https://docs.example.com
                </span>
              </p>
              <div className="mt-6 sm:mt-8">
                <Button
                  href="#"
                  className="w-full bg-ink-foreground text-ink hover:opacity-90 sm:w-auto dark:bg-foreground dark:text-background"
                >
                  Start with your docs
                </Button>
              </div>
            </div>
          </div>
          </div>

          <div className="rounded-2xl border border-border bg-card-solid px-5 py-8 shadow-card sm:rounded-3xl sm:px-8 sm:py-10 lg:px-10">
            <Eyebrow className="mb-3">For teams</Eyebrow>
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl lg:text-3xl">
              Ready for the real load
            </h2>
            <ul className="mt-3 space-y-2.5 sm:mt-4">
              {ENTERPRISE_POINTS.map((point) => (
                <li
                  key={point}
                  className="flex items-baseline gap-2.5 text-sm leading-6 text-muted"
                >
                  <span aria-hidden className="shrink-0 font-mono text-xs text-accent">
                    ▸
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-6 sm:mt-8">
              <Button href="#" variant="secondary" className="w-full sm:w-auto">
                Book a demo
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
