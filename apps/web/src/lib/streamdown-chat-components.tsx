"use client";

import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText,
} from "@/components/ai-elements/inline-citation";
import {
  findCitationSourcesForHref,
  type CitationSource,
} from "@/lib/message-citation-sources";
import { cn } from "@/lib/utils";
import type { Components } from "streamdown";
import {
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

const CitationSourcesContext = createContext<CitationSource[]>([]);

export function CitationSourcesProvider({
  sources,
  children,
}: {
  sources: CitationSource[];
  children: ReactNode;
}) {
  return (
    <CitationSourcesContext.Provider value={sources}>
      {children}
    </CitationSourcesContext.Provider>
  );
}

function useCitationSources() {
  return useContext(CitationSourcesContext);
}

function CitationMarkdownLink({
  href,
  children,
  className,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  const allSources = useCitationSources();
  const matched = findCitationSourcesForHref(allSources, href);

  if (!href || matched.length === 0) {
    return (
      <a
        href={href}
        className={className}
        rel="noreferrer"
        target="_blank"
        {...props}
      >
        {children}
      </a>
    );
  }

  const urls = matched.map((source) => source.url);

  return (
    <InlineCitation>
      <InlineCitationText>
        <a
          href={href}
          className={cn("underline-offset-2", className)}
          rel="noreferrer"
          target="_blank"
          {...props}
        >
          {children}
        </a>
      </InlineCitationText>
      <InlineCitationCard>
        <InlineCitationCardTrigger sources={urls} />
        <InlineCitationCardBody>
          <InlineCitationCarousel>
            {matched.length > 1 ? (
              <InlineCitationCarouselHeader>
                <InlineCitationCarouselPrev />
                <InlineCitationCarouselNext />
                <InlineCitationCarouselIndex />
              </InlineCitationCarouselHeader>
            ) : null}
            <InlineCitationCarouselContent>
              {matched.map((source) => (
                <InlineCitationCarouselItem key={source.url}>
                  <InlineCitationSource
                    title={source.title}
                    url={source.url}
                    description={source.description}
                  />
                  {source.quote ? (
                    <InlineCitationQuote>{source.quote}</InlineCitationQuote>
                  ) : null}
                </InlineCitationCarouselItem>
              ))}
            </InlineCitationCarouselContent>
          </InlineCitationCarousel>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}

/**
 * Streamdown markdown overrides for LedgeIndex chat.
 * Default inline code uses `bg-muted`, but our `--muted` token is a text color —
 * in dark mode that yields washed-out pills (light text on mid-gray).
 */
export const streamdownChatComponents: Components = {
  p: ({ className, ...props }) => (
    <div className={cn("chat-md-p", className)} {...props} />
  ),
  a: CitationMarkdownLink,
  inlineCode: ({ className, children, ...props }) => (
    <code
      className={cn(
        "chat-md-inline-code rounded-md border border-border/70 bg-surface-alt px-1.5 py-0.5 font-mono text-[0.8125rem] font-medium text-foreground",
        className,
      )}
      data-streamdown="inline-code"
      {...props}
    >
      {children}
    </code>
  ),
};
