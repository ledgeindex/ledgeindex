/** Curated research lenses for library / framework / API / service profiles. */

export type SiteProfileLensId =
  | "docs_identity"
  | "identity"
  | "capabilities"
  | "integrations"
  | "ai_and_dev_experience"
  | "basic_usage"
  | "main_use_cases"
  | "package_primitives_usage"
  | "package_usage_examples"
  | "business_usage"
  | "business_model"
  | "pricing"
  | "gtm";

export type SiteProfileLensOption = {
  id: SiteProfileLensId;
  label: string;
  description: string;
};

export type SiteProfileLensGroup = {
  id: string;
  label: string;
  description: string;
  lensIds: SiteProfileLensId[];
};

const LENS_BY_ID: Record<SiteProfileLensId, SiteProfileLensOption> = {
  docs_identity: {
    id: "docs_identity",
    label: "About / shelf",
    description: "What it is — framework, library, API, tooling",
  },
  identity: {
    id: "identity",
    label: "Positioning",
    description: "One-liner, category, who it’s for",
  },
  capabilities: {
    id: "capabilities",
    label: "Capabilities",
    description: "Core modules and feature pillars",
  },
  integrations: {
    id: "integrations",
    label: "Integrations",
    description: "Connectors, ecosystems, channels",
  },
  ai_and_dev_experience: {
    id: "ai_and_dev_experience",
    label: "Dev experience",
    description: "APIs, SDKs, MCP, builder tooling",
  },
  basic_usage: {
    id: "basic_usage",
    label: "Basic usage",
    description: "Quickstart and hello-world paths",
  },
  main_use_cases: {
    id: "main_use_cases",
    label: "Main use cases",
    description: "Primary scenarios this product is for",
  },
  package_primitives_usage: {
    id: "package_primitives_usage",
    label: "Primitives",
    description: "Core APIs and builder moves",
  },
  package_usage_examples: {
    id: "package_usage_examples",
    label: "Guides & examples",
    description: "Tutorials, recipes, templates",
  },
  business_usage: {
    id: "business_usage",
    label: "Business usage",
    description: "Problems teams solve with it",
  },
  business_model: {
    id: "business_model",
    label: "Business model",
    description: "Offering, acquisition, onboarding, monetization",
  },
  pricing: {
    id: "pricing",
    label: "Pricing",
    description: "Plans, price text, trial signals",
  },
  gtm: {
    id: "gtm",
    label: "Go-to-market",
    description: "Self-serve vs sales, CTAs, demo/trial",
  },
};

export const SITE_PROFILE_LENS_GROUPS: SiteProfileLensGroup[] = [
  {
    id: "about",
    label: "About",
    description: "What this source is and who it’s for",
    lensIds: ["docs_identity", "identity", "capabilities"],
  },
  {
    id: "developer",
    label: "Developer",
    description: "How builders use it day to day",
    lensIds: [
      "integrations",
      "ai_and_dev_experience",
      "basic_usage",
      "main_use_cases",
      "package_primitives_usage",
      "package_usage_examples",
    ],
  },
  {
    id: "business",
    label: "Business",
    description: "Outcomes, monetization, and how they sell",
    lensIds: ["business_usage", "business_model", "pricing", "gtm"],
  },
];

/** Default Add-profile selection: shelf + usage + primitives + guides + business. */
export const DEFAULT_SITE_PROFILE_LENS_IDS: SiteProfileLensId[] = [
  "docs_identity",
  "basic_usage",
  "package_primitives_usage",
  "package_usage_examples",
  "business_usage",
];

/** Every curated lens. */
export const FULL_SITE_PROFILE_LENS_IDS: SiteProfileLensId[] = [
  "docs_identity",
  "identity",
  "capabilities",
  "integrations",
  "ai_and_dev_experience",
  "basic_usage",
  "main_use_cases",
  "package_primitives_usage",
  "package_usage_examples",
  "business_usage",
  "business_model",
  "pricing",
  "gtm",
];

export const PACKAGE_SITE_PROFILE_LENS_IDS: SiteProfileLensId[] = [
  "docs_identity",
  "package_primitives_usage",
  "package_usage_examples",
  "basic_usage",
  "main_use_cases",
];

export function siteProfileLensLabel(id: string): string {
  return LENS_BY_ID[id as SiteProfileLensId]?.label ?? id;
}

export function getSiteProfileLensOption(
  id: SiteProfileLensId,
): SiteProfileLensOption {
  return LENS_BY_ID[id];
}

export function isSiteProfileLensId(value: string): value is SiteProfileLensId {
  return value in LENS_BY_ID;
}
