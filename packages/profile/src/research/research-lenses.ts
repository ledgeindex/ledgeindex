import { z } from "zod";

export const researchLensIds = [
  "identity",
  "docs_identity",
  "capabilities",
  "pricing",
  "integrations",
  "trust",
  "gtm",
  "ai_and_dev_experience",
  "basic_usage",
  "main_use_cases",
  "business_usage",
  "package_primitives_usage",
  "package_usage_examples",
  "content_seo_strategy",
] as const;

export type ResearchLens = (typeof researchLensIds)[number];

export const researchLensSchema = z.enum(researchLensIds);

export const citationSchema = z.object({
  url: z.string(),
  quote: z.string().optional(),
});

/** Shared ranking for features / use cases (shown as UI badges). */
export const researchPrioritySchema = z.enum(["main", "top", "supporting"]);
export type ResearchPriority = z.infer<typeof researchPrioritySchema>;

export const identityLensSchema = z.object({
  category: z.string(),
  oneLiner: z.string(),
  primaryBuyers: z.array(z.string()),
  segmentsAndIndustries: z.array(z.string()),
  notes: z.string().optional(),
  citations: z.array(citationSchema),
});

/**
 * Docs-set identity: profile what an indexed docs URL covers.
 * Pick pages are CONTEXT only (same as other lenses) — they are not the output.
 */
export const docsIdentityLensSchema = z.object({
  /** 2–4 sentences describing what this documentation set covers. */
  overallSummary: z
    .string()
    .min(1)
    .describe(
      "2–4 sentences on what this documentation covers as a whole",
    ),
  /** Shelf: frameworks, libraries, APIs & services, or uncategorized. */
  kind: z
    .enum(["frameworks", "libraries", "apis-services", "tooling", "uncategorized"])
    .describe(
      "Primary shelf: frameworks | libraries | apis-services | tooling | uncategorized",
    ),
  /** Primary language the docs are about. */
  language: z
    .enum(["javascript", "typescript", "python", "other"])
    .describe(
      "Primary language: javascript | typescript | python | other",
    ),
  notes: z.string().optional(),
  citations: z.array(citationSchema).optional(),
});

export const capabilitiesLensSchema = z.object({
  capabilities: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      /**
       * main = core product pillars / flagship modules — usually 2–4
       * top = important secondary features
       * supporting = niche or secondary capabilities
       * REQUIRED on every capability — UI shows this as a badge.
       */
      priority: researchPrioritySchema,
      tierOrLimit: z.string().optional(),
      citation: citationSchema,
    }),
  ),
  gapsOrUnclear: z.string().optional(),
});

export const pricingLensSchema = z.object({
  plans: z.array(
    z.object({
      name: z.string(),
      priceText: z.string(),
      billingPeriod: z.string().optional(),
      limits: z.string().optional(),
      citation: citationSchema,
    }),
  ),
  enterpriseOrCustom: z.string().optional(),
  trialOrFreeTier: z.string().optional(),
});

export const integrationsLensSchema = z.object({
  integrations: z.array(
    z.object({
      name: z.string(),
      category: z.string().optional(),
      citation: citationSchema,
    }),
  ),
});

export const trustLensSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string(),
      citation: citationSchema,
    }),
  ),
});

export const gtmLensSchema = z.object({
  motion: z.string(),
  primaryCtas: z.array(z.string()),
  trialDemoSignup: z.string().optional(),
  citations: z.array(citationSchema),
});

export const aiDevExperienceLensSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      citation: citationSchema,
    }),
  ),
});

/** Hello-world / quickstart / first tutorial paths for builders. */
export const basicUsageLensSchema = z.object({
  examples: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      /** e.g. quickstart, hello-world, install, first-script */
      kind: z.string().optional(),
      prerequisites: z.array(z.string()).optional(),
      citation: citationSchema,
    }),
  ),
  notes: z.string().optional(),
});

/** Primary product scenarios / recipes worth turning into usage examples. */
export const mainUseCasesLensSchema = z.object({
  useCases: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      /**
       * main = core product pillars (what this product is for) — usually 2–4
       * top = high-frequency / featured scenarios after the pillars
       * supporting = valid but secondary (only if clearly documented)
       * REQUIRED on every use case — UI shows this as a badge.
       */
      priority: researchPrioritySchema,
      /** Who it is for, or problem solved */
      audienceOrProblem: z.string().optional(),
      /** Suggested example title if building a catalog later */
      suggestedExampleTitle: z.string().optional(),
      citation: citationSchema,
    }),
  ),
  notes: z.string().optional(),
});

/** Package Library: core primitives / APIs / builder moves (not business outcomes). */
export const packagePrimitivesUsageLensSchema = z.object({
  primitives: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      priority: researchPrioritySchema,
      /** API symbol or primitive name, e.g. stagehand.act, cheerio.load */
      primitiveOrApi: z.string().optional(),
      /** Short how-to from docs */
      howToHint: z.string().optional(),
      /** Minimal usage example (steps or code sketch) from docs */
      usageExample: z.string().optional(),
      /** Additional named code snippets (step 2 enrichment). */
      usageExamples: z
        .array(
          z.object({
            title: z.string().optional(),
            language: z.string().optional(),
            code: z.string(),
          }),
        )
        .optional(),
      /** Suggested Package Library grounding template title */
      suggestedTemplateTitle: z.string().optional(),
      citation: citationSchema.optional(),
    }),
  ),
  notes: z.string().optional(),
});

/** Package Library: concrete guides, tutorials, and example recipes (not abstract primitives). */
export const packageUsageExamplesLensSchema = z.object({
  examples: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      priority: researchPrioritySchema,
      /** quickstart | guide | tutorial | recipe | template | example */
      kind: z.string().optional(),
      /** Primitive names this example exercises, if stated */
      primitivesUsed: z.array(z.string()).optional(),
      suggestedExampleTitle: z.string().optional(),
      /** Primary code sample (step 2 enrichment). */
      usageExample: z.string().optional(),
      usageExamples: z
        .array(
          z.object({
            title: z.string().optional(),
            language: z.string().optional(),
            code: z.string(),
          }),
        )
        .optional(),
      /** Full markdown of the cited source page (attached after fetch, not from LLM). */
      pageMarkdown: z.string().optional(),
      citation: citationSchema,
    }),
  ),
  notes: z.string().optional(),
});

/** How the site uses content and SEO to attract and convert (discovery strategy). */
export const contentSeoIntentSchema = z.enum([
  "informational",
  "commercial",
  "transactional",
  "mixed",
]);

export const contentSeoStrategyLensSchema = z.object({
  /** 2–4 sentences: apparent content + organic discovery strategy. */
  strategySummary: z.string(),
  pillars: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      priority: researchPrioritySchema,
      searchIntent: contentSeoIntentSchema.optional(),
      /** Paths, hubs, or section names where this pillar lives. */
      siteAreas: z.array(z.string()).optional(),
      /** Representative queries this pillar seems to target. */
      exampleQueries: z.array(z.string()).optional(),
      citation: citationSchema,
    }),
  ),
  urlPatterns: z.array(
    z.object({
      pattern: z.string(),
      role: z.string(),
      citation: citationSchema.optional(),
    }),
  ),
  strengths: z.array(
    z.object({
      point: z.string(),
      citation: citationSchema.optional(),
    }),
  ),
  gaps: z.array(
    z.object({
      point: z.string(),
      citation: citationSchema.optional(),
    }),
  ),
  notes: z.string().optional(),
});

/**
 * Real-world business applications — problems teams solve and what they build/run with the product.
 * Distinct from main_use_cases (technical/docs scenarios) and capabilities (feature inventory).
 */
export const businessUsageLensSchema = z.object({
  usages: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      /**
       * main = primary problems this product is bought to solve — usually 2–4
       * top = common secondary business problems / applications
       * supporting = niche or industry-specific problems
       * REQUIRED on every item — UI shows this as a badge.
       */
      priority: researchPrioritySchema,
      /** The real business pain / problem being solved (prefer always filling this) */
      problem: z.string().optional(),
      /** Business buyer, team, or industry (e.g. support teams, fintech ops) */
      audienceOrIndustry: z.string().optional(),
      /** Product features / modules used to solve that problem, if stated */
      featuresUsed: z.array(z.string()).optional(),
      /** Business outcome after solving the problem */
      outcome: z.string().optional(),
      citation: citationSchema,
    }),
  ),
  notes: z.string().optional(),
});

export type IdentityLensOutput = z.infer<typeof identityLensSchema>;
export type DocsIdentityLensOutput = z.infer<typeof docsIdentityLensSchema>;
export type CapabilitiesLensOutput = z.infer<typeof capabilitiesLensSchema>;
export type PricingLensOutput = z.infer<typeof pricingLensSchema>;
export type IntegrationsLensOutput = z.infer<typeof integrationsLensSchema>;
export type TrustLensOutput = z.infer<typeof trustLensSchema>;
export type GtmLensOutput = z.infer<typeof gtmLensSchema>;
export type AiDevExperienceLensOutput = z.infer<typeof aiDevExperienceLensSchema>;
export type BasicUsageLensOutput = z.infer<typeof basicUsageLensSchema>;
export type MainUseCasesLensOutput = z.infer<typeof mainUseCasesLensSchema>;
export type PackagePrimitivesUsageLensOutput = z.infer<
  typeof packagePrimitivesUsageLensSchema
>;
export type PackageUsageExamplesLensOutput = z.infer<
  typeof packageUsageExamplesLensSchema
>;
export type ContentSeoStrategyLensOutput = z.infer<typeof contentSeoStrategyLensSchema>;
export type BusinessUsageLensOutput = z.infer<typeof businessUsageLensSchema>;

export type LensOutputById = {
  identity: IdentityLensOutput;
  docs_identity: DocsIdentityLensOutput;
  capabilities: CapabilitiesLensOutput;
  pricing: PricingLensOutput;
  integrations: IntegrationsLensOutput;
  trust: TrustLensOutput;
  gtm: GtmLensOutput;
  ai_and_dev_experience: AiDevExperienceLensOutput;
  basic_usage: BasicUsageLensOutput;
  main_use_cases: MainUseCasesLensOutput;
  business_usage: BusinessUsageLensOutput;
  package_primitives_usage: PackagePrimitivesUsageLensOutput;
  package_usage_examples: PackageUsageExamplesLensOutput;
  content_seo_strategy: ContentSeoStrategyLensOutput;
};

type LensDefinition<L extends ResearchLens> = {
  id: L;
  label: string;
  pickMessage: string;
  synthInstructions: string;
  schema: z.ZodType<LensOutputById[L]>;
};

const BASE_SYNTH_RULES = `Use ONLY the provided page excerpts. Do not invent facts. Every factual item needs a citation with source URL; add a short quote when the page states it explicitly.`;

export const RESEARCH_LENSES: { [K in ResearchLens]: LensDefinition<K> } = {
  identity: {
    id: "identity",
    label: "Positioning & ICP",
    pickMessage:
      "Select URLs for company positioning and target audience: home, about, mission, company story, solutions overview, who-we-serve. Prefer 3–8 pages. Skip blog posts unless they are core positioning pages.",
    synthInstructions: `${BASE_SYNTH_RULES} Extract category, one-line promise, primary buyer roles, and named segments or industries.`,
    schema: identityLensSchema,
  },
  docs_identity: {
    id: "docs_identity",
    label: "About",
    pickMessage:
      "Select pages that help describe what this documentation site/root is about: the start URL itself, getting started, overview, intro, concepts, and top-level docs hubs (4–10). These pages are CONTEXT for synthesizing one docs identity profile — not separate outputs.",
    synthInstructions: `${BASE_SYNTH_RULES}
Your job is DOCS IDENTITY — same pattern as other profile lenses: use the picked pages as evidence, then write ONE profile for the site/docs URL that was profiled.

1. overallSummary (required): 2–4 sentences on what this documentation covers — topics, who it helps, what questions it answers. Write about the docs set as a whole (e.g. mastra.ai/docs), NOT a list of nested URLs.
2. kind (required): exactly one of "frameworks" | "libraries" | "apis-services" | "tooling" | "uncategorized"
   - frameworks = app/agent frameworks, platforms you build on
   - libraries = SDKs, packages, helpers you import into apps
   - apis-services = hosted APIs, SaaS, cloud services
   - tooling = compilers, bundlers, linters, test runners, package managers, CLIs
   - uncategorized = unclear or mixed
3. language (required): exactly one of "javascript" | "typescript" | "python" | "other" for the primary language the docs target.
4. citations: ground claims when possible.
5. Do not invent sections. Do not output per-path hubs — picked URLs stay in the research context only.`,
    schema: docsIdentityLensSchema,
  },
  capabilities: {
    id: "capabilities",
    label: "Product & features",
    pickMessage:
      "Select product, platform, features, and solution pages that describe what the product does and modules offered. Prefer hub/overview + flagship feature pages (5–12). Avoid generic blog unless it is a product announcement with feature detail. Bias to first-class modules over long-tail niche pages.",
    synthInstructions: `${BASE_SYNTH_RULES}
Your job is to rank product features — not dump every capability as equals.

1. First list 2–4 **main** capabilities: core pillars / flagship modules the product is known for. Tag priority: "main".
2. Then list up to 3–5 **top** capabilities: important secondary features clearly promoted. Tag priority: "top".
3. Only add **supporting** for clearly documented but secondary capabilities — keep the total list short (aim ≤ 10). Tag priority: "supporting".

For each item you MUST set priority to exactly one of: "main", "top", or "supporting" (required — never omit). Also include: name, short description, optional tierOrLimit if stated, and citation.
Order the array: all main first, then top, then supporting. Merge duplicates.`,
    schema: capabilitiesLensSchema,
  },
  pricing: {
    id: "pricing",
    label: "Pricing",
    pickMessage:
      "Select pricing, plans, and billing pages. ALWAYS include the site root/home URL (/) when it appears in the catalog — many sites show plans or 'contact sales' only on the homepage. Include product pages only if they contain plan tables or explicit prices. Prefer 1–6 pages; never return an empty selection if the homepage is in the list.",
    synthInstructions: `${BASE_SYNTH_RULES} Extract plans with price text exactly as shown; do not invent numbers.`,
    schema: pricingLensSchema,
  },
  integrations: {
    id: "integrations",
    label: "Integrations",
    pickMessage:
      "Select integrations, connectors, marketplace, deploy, and connect product pages that name third-party tools or channels.",
    synthInstructions: `${BASE_SYNTH_RULES} List integrations, ecosystems, and channels named on these pages.`,
    schema: integrationsLensSchema,
  },
  trust: {
    id: "trust",
    label: "Trust & security",
    pickMessage:
      "Select security, compliance, trust center, privacy, and enterprise readiness pages.",
    synthInstructions: `${BASE_SYNTH_RULES} List compliance, security, and data-handling claims with citations.`,
    schema: trustLensSchema,
  },
  gtm: {
    id: "gtm",
    label: "Go-to-market",
    pickMessage:
      "Select pages that show how to buy or start: pricing, demo, signup, contact sales, trial, get started.",
    synthInstructions: `${BASE_SYNTH_RULES} Describe sales motion (self-serve vs sales-led), primary CTAs, and trial/demo/signup signals.`,
    schema: gtmLensSchema,
  },
  ai_and_dev_experience: {
    id: "ai_and_dev_experience",
    label: "AI & developer experience",
    pickMessage:
      "Select pages about API, SDK, MCP, docs, developer tools, retrieval API, and AI assistant integration for builders.",
    synthInstructions: `${BASE_SYNTH_RULES} List developer-facing capabilities (APIs, SDKs, MCP, docs integration, etc.).`,
    schema: aiDevExperienceLensSchema,
  },
  basic_usage: {
    id: "basic_usage",
    label: "Basic usage",
    pickMessage:
      "Select getting-started, quickstart, installation, hello-world, first tutorial, and intro guide pages that show the simplest way to use the product or library. Prefer 2–8 pages. ALWAYS include docs home or /docs when present. Skip marketing-only pages unless they embed a minimal code sample.",
    synthInstructions: `${BASE_SYNTH_RULES} Extract the basic / hello-world usage paths: name each starter example, what it teaches, optional kind (quickstart, install, hello-world), prerequisites if stated, and cite the page. Prefer concrete runnable starters over abstract overviews.`,
    schema: basicUsageLensSchema,
  },
  main_use_cases: {
    id: "main_use_cases",
    label: "Main use cases",
    pickMessage:
      "Select pages that define what this product is FOR — not every tutorial. Prefer: docs home/overview, introduction, use-cases hub, solutions, featured examples, and top-level guides that name primary scenarios. Include /use-cases, /examples, /guides, /solutions, /overview when present. Prefer 4–10 pages. SKIP deep API reference, changelog, and long-tail recipe pages unless the catalog has no overview/use-case pages. Do NOT select a random spread of niche how-tos; bias to hub + featured + first-class scenarios.",
    synthInstructions: `${BASE_SYNTH_RULES}
Your job is to identify the MAIN and TOP use cases — not dump every valid scenario as equals.

1. First list 2–4 **main** use cases: the core pillars / primary reasons someone adopts this product (what docs/marketing position as first-class). Tag priority: "main".
2. Then list up to 3–5 **top** use cases: frequently featured or high-value scenarios that are clearly promoted but secondary to the pillars. Tag priority: "top".
3. Only add **supporting** if the pages clearly call them out and they are still useful for an example catalog — keep the total list short (aim ≤ 8). Tag priority: "supporting".

For each item you MUST set priority to exactly one of: "main", "top", or "supporting" (required — never omit). Also include: name, short description, optional audienceOrProblem, optional suggestedExampleTitle (catalog-ready), and citation.
Order the array: all main first, then top, then supporting.
Deduplicate near-duplicates. Prefer scenarios someone would turn into a usage example later. If the pages only show niche recipes and no clear pillars, say so in notes and still rank the strongest ones as best-effort main/top.`,
    schema: mainUseCasesLensSchema,
  },
  business_usage: {
    id: "business_usage",
    label: "Business usage",
    pickMessage:
      "Select pages that show REAL PROBLEMS this product solves for businesses — pain points, jobs-to-be-done, solutions by industry/role, customers, case studies, 'why teams use', 'built for', who-we-serve, and outcome pages. Prefer 4–10 pages. Include homepage / solutions / customers / case-studies / industries / use-cases (business framing) when present. SKIP pure API reference, install guides, and feature-spec pages unless they explicitly state a business problem and outcome. Bias to pages that answer: what painful problem do teams solve with this, and what do they build/run as a result?",
    synthInstructions: `${BASE_SYNTH_RULES}
Your job is BUSINESS PROBLEM → USAGE. Extract the real problems companies solve with this product, and what they build or run to solve them — not a feature inventory and not a developer tutorial list.

Frame every item as: problem (pain) → what is built/used → who it serves → outcome. Features are supporting context only (featuresUsed), never the headline.

1. First list 2–4 **main** usages: the core problems buyers hire this product for / the main things teams build to solve those pains. Tag priority: "main".
2. Then list up to 3–5 **top** usages: common secondary business problems clearly promoted. Tag priority: "top".
3. Only add **supporting** for niche or industry-specific problems clearly documented — keep total short (aim ≤ 8). Tag priority: "supporting".

Reject items that are only feature names ("Agents", "Workflows", "RAG") with no problem framing — rewrite them as business problems if the pages support it, otherwise drop them.

For each item you MUST set priority to exactly one of: "main", "top", or "supporting" (required — never omit). Prefer filling **problem** on every item. Also include: name (problem- or outcome-oriented, not feature-oriented), short description (problem + how they use the product), optional audienceOrIndustry, optional featuresUsed, optional outcome, and citation.
Order the array: all main first, then top, then supporting. Deduplicate. If pages only show technical how-tos with no business problem framing, say so in notes and best-effort extract the strongest problem readings from marketing/overview language.`,
    schema: businessUsageLensSchema,
  },
  package_primitives_usage: {
    id: "package_primitives_usage",
    label: "Package primitives",
    pickMessage:
      "Select pages that define HOW TO USE this package's building blocks — introduction, basics, API overview, core concepts, and first-steps guides that name executable primitives (functions, methods, CLI moves). Prefer /docs, /basics, /api, /reference/overview, /first-steps, /concepts. Prefer 4–10 pages. SKIP pure marketing/ICP pages, business case studies, and long-tail recipe pages unless no overview exists. Bias to pages that name APIs and moves, not business outcomes.",
    synthInstructions: `${BASE_SYNTH_RULES}
Your job is PACKAGE PRIMITIVES — the core building blocks and how developers use them. This is NOT business usage and NOT full tutorial recipes.

1. List 2–4 **main** primitives: flagship APIs/moves the package is built around (what docs position as first-class). Tag priority: "main".
2. List up to 3–5 **top** primitives: important secondary APIs/patterns clearly promoted. Tag priority: "top".
3. Only add **supporting** for clearly documented but secondary moves — keep total short (aim ≤ 10). Tag priority: "supporting".

Each item MUST have priority exactly one of: "main", "top", or "supporting". Include: name, short description, optional primitiveOrApi (symbol or method), optional howToHint (one line on usage), optional usageExample (minimal code or steps from docs), optional suggestedTemplateTitle (catalog-ready template name), and citation when the pages support it.
Order: main, then top, then supporting. Deduplicate. Reject vague business outcomes ("help teams automate") — those belong elsewhere. Reject whole tutorial scenarios without naming the underlying primitive — those belong in package_usage_examples.`,
    schema: packagePrimitivesUsageLensSchema,
  },
  package_usage_examples: {
    id: "package_usage_examples",
    label: "Package guides & examples",
    pickMessage:
      "Select pages with CONCRETE GUIDES and EXAMPLES — quickstarts, tutorials, recipes, templates, sample projects, cookbooks, and worked scenarios with code paths. Prefer /examples, /guides, /tutorials, /recipes, /templates, /cookbook, /quickstart. Prefer 4–12 pages. SKIP API reference-only pages and marketing unless they embed a runnable example. Bias to pages someone could mirror as a Package Library example.",
    synthInstructions: `${BASE_SYNTH_RULES}
Your job is GUIDES & EXAMPLES — concrete scenarios/recipes from docs, not abstract primitive lists.

1. List 2–4 **main** examples: flagship tutorials/quickstarts the docs promote. Tag priority: "main".
2. List up to 3–5 **top** examples: other high-value guides clearly featured. Tag priority: "top".
3. Only add **supporting** for useful niche recipes — keep total short (aim ≤ 10). Tag priority: "supporting".

Each item MUST have priority exactly one of: "main", "top", or "supporting". Include: name, short description, optional kind (quickstart, guide, tutorial, recipe, template, example), optional primitivesUsed (names of primitives exercised), optional suggestedExampleTitle, and citation.
Order: main, then top, then supporting. Deduplicate. Do NOT restate the primitive inventory without a worked scenario — that belongs in package_primitives_usage.`,
    schema: packageUsageExamplesLensSchema,
  },
  content_seo_strategy: {
    id: "content_seo_strategy",
    label: "Content & SEO strategy",
    pickMessage:
      "Select pages that reveal CONTENT and ORGANIC DISCOVERY strategy: blog/resources/learn hubs, docs landing and category hubs, guides/tutorials index pages, comparison/alternative pages, customer stories used as SEO, changelog or release content, glossary/FAQ hubs, and key marketing landings that target search intent. Prefer home + 5–12 content/SEO-shaped URLs. SKIP deep API reference leaf pages unless they are clearly SEO landing pages. Bias to hubs and templates that show how they attract traffic, not single feature blurbs.",
    synthInstructions: `${BASE_SYNTH_RULES}
Your job is CONTENT & SEO STRATEGY — how this site uses content to be discovered and convert search/AI visitors. This is NOT a product feature list (capabilities), NOT buyer problem inventory (business_usage), and NOT developer tutorials inventory (package_usage_examples).

1. strategySummary: 2–4 sentences on their apparent organic/content strategy (docs-led, blog-led, product-led SEO, programmatic pages, etc.).
2. pillars: 2–4 **main** topic pillars they build content around; up to 3–5 **top**; optional **supporting**. Each needs priority, name, description, optional searchIntent (informational | commercial | transactional | mixed), optional siteAreas (paths/hubs), optional exampleQueries (how people might search), and citation.
3. urlPatterns: recurring URL templates (e.g. /blog/*, /docs/v3/*, /integrations/*) and what role each plays in discovery.
4. strengths: 2–5 concrete strengths of their content/SEO approach (with citation when possible).
5. gaps: 2–5 gaps or missing plays vs their positioning (missing comparison page, thin meta on hubs, no clear pillar for X) — grounded in what you did or did not see.

Order pillars: main, then top, then supporting. Do not invent rankings or traffic — only strategy signals from pages.`,
    schema: contentSeoStrategyLensSchema,
  },
};

export type CompanyProfileData = {
  [K in ResearchLens]?: LensOutputById[K];
};

export function getResearchLens(id: string): ResearchLens {
  return researchLensSchema.parse(id);
}

export function getLensDefinition<L extends ResearchLens>(lens: L): LensDefinition<L> {
  return RESEARCH_LENSES[lens];
}

export const PROFILE_MODE_ID = "profile" as const;

export function defaultProfileLenses(): ResearchLens[] {
  return [...researchLensIds];
}

export function parseResearchLensList(raw: string): ResearchLens[] {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error("Expected at least one lens id in --lenses");
  }
  return ids.map((id) => getResearchLens(id));
}

export function resolveProfileLenses(lenses?: ResearchLens[]): ResearchLens[] {
  return lenses?.length ? lenses : defaultProfileLenses();
}
