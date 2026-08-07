import { Container } from "@/components/ui/container";
import { SectionBadge } from "@/components/ui/section-badge";

const FAQS = [
  {
    question: "What do I build with it?",
    answer:
      "An assistant that answers from your docs: on your site, in support, or inside your own tools. People get replies with links to the pages they came from, so they can check the answer themselves.",
  },
  {
    question: "Is LedgeIndex just another chatbot?",
    answer:
      "No. LedgeIndex is the layer that reads your docs and finds the right pages. You can use our ready-made chat, or plug the same index into something you build. Same knowledge either way.",
  },
  {
    question: "Which sources can I connect?",
    answer:
      "Documentation sites: point us at a URL and we crawl the pages. If there is no site to crawl, you can write the pages yourself in the source builder. When your docs change, re-crawl and we keep the older version around.",
  },
  {
    question: "How do my tools get answers?",
    answer:
      "Through an SDK, a simple API, or a connector that tools like Claude and Cursor already understand. You pick the model. We handle finding the right docs and attaching the links.",
  },
  {
    question: "How do you keep answers honest?",
    answer:
      "Every reply points back to the pages it used. You can see which content drove which answer, and which questions your docs still miss. That makes it easier to fix the gaps before users hit them again.",
  },
  {
    question: "Where does my data live?",
    answer:
      "In our cloud or on your own machines. Either way you can query and export your docs. Nothing is locked in a black box.",
  },
  {
    question: "How does pricing work?",
    answer:
      "Cloud pricing follows how much you index and how often people ask. You do not pay per seat. Start free while you try it. Self-hosting the open source engine stays free.",
  },
] as const;

export function FaqSection() {
  return (
    <section id="faq" className="relative overflow-hidden border-b border-border/60 py-12 sm:py-16 lg:py-20">
      <div aria-hidden className="section-glow-warm pointer-events-none absolute inset-0" />
      <Container className="relative">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <SectionBadge>FAQ</SectionBadge>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Common questions
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted sm:text-base sm:leading-7">
              Security reviews, custom setups, and anything else: we cover that
              on a demo call.
            </p>
          </div>

          <div className="divide-y divide-border rounded-2xl border border-border bg-card-solid shadow-card">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group px-4 sm:px-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-semibold text-foreground sm:gap-4 sm:py-5 sm:text-base [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span
                    aria-hidden
                    className="shrink-0 font-mono text-lg leading-none text-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-5 text-sm leading-6 text-muted sm:text-[0.9375rem] sm:leading-7">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
