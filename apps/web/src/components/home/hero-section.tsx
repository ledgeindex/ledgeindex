import { Container } from "@/components/ui/container";
import { HeroUrlCta } from "@/components/home/hero-url-cta";
import { HeroChatShowcase } from "@/components/home/hero-chat-showcase";

const HERO_CHIPS = ["Docs chat", "Support help", "Onboarding", "Agents"] as const;

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="relative py-12 sm:py-20 lg:py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/hero-grid-bg.webp"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center opacity-[0.14] dark:opacity-[0.09] saturate-[0.55] contrast-[0.95]"
            suppressHydrationWarning
          />
          <div className="hero-scenic-overlay absolute inset-0" />
          <div className="hero-paper-glow absolute inset-0" />
          <div className="hero-paper-grain absolute inset-0" />
        </div>

        <Container className="relative">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
            {/* left — copy */}
            <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
              <h1 className="text-[1.75rem] leading-[1.1] font-semibold tracking-tight text-balance text-foreground sm:text-4xl sm:leading-[1.08] lg:text-[3rem]">
                Turn your documentation into{" "}
                <span className="relative inline-block pb-1">
                  <span className="relative z-[1]">answers people trust.</span>
                  <span
                    aria-hidden
                    className="hero-paper-underline absolute inset-x-0 bottom-0 h-[0.18em] min-h-[2px] rounded-[1px] opacity-90"
                  />
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:mt-6 sm:text-lg sm:leading-8">
                Point LedgeIndex at your docs. Users get replies with links back
                to the pages they came from, so they can open and check.
              </p>

              <HeroUrlCta className="mt-8 max-w-xl sm:mt-10" />

              <a
                href="#showcase"
                className="mt-4 text-sm text-muted transition-colors hover:text-foreground"
              >
                See what teams ship with it →
              </a>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 lg:justify-start">
                {HERO_CHIPS.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-md border border-border/90 bg-card-solid/85 px-2.5 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase shadow-[0_1px_1px_rgb(15_23_42/0.03)] sm:px-3 sm:text-[0.625rem] sm:tracking-[0.12em] dark:shadow-[0_1px_0_rgb(255_248_246/0.03)_inset]"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {/* right — chat with your docs showcase */}
            <HeroChatShowcase className="mx-auto w-full max-w-md lg:max-w-none" />
          </div>
        </Container>
      </div>
    </section>
  );
}
