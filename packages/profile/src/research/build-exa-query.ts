import type { CompanyProfileData, IdentityLensOutput } from "./research-lenses.js";

export const LANDSCAPE_PROFILE_LENS_IDS = [
  "identity",
  "business_usage",
  "main_use_cases",
  "gtm",
  "pricing",
  "capabilities",
] as const;

function mainBusinessProblems(profile: CompanyProfileData): string[] {
  const usages = profile.business_usage?.usages ?? [];
  return usages
    .filter((u) => u.priority === "main")
    .map((u) => u.problem?.trim() || u.name.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function mainUseCaseNames(profile: CompanyProfileData): string[] {
  const cases = profile.main_use_cases?.useCases ?? [];
  return cases
    .filter((u) => u.priority === "main")
    .map((u) => u.name.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function buildExaQueryFromProfile(
  profile: CompanyProfileData,
  subjectUrl: string,
): string {
  const identity = profile.identity as IdentityLensOutput | undefined;
  const parts: string[] = [];

  if (identity?.category?.trim()) {
    parts.push(`Companies in category: ${identity.category.trim()}`);
  }
  if (identity?.oneLiner?.trim()) {
    parts.push(identity.oneLiner.trim());
  }
  if (identity?.primaryBuyers?.length) {
    parts.push(`Buyers: ${identity.primaryBuyers.slice(0, 5).join(", ")}`);
  }

  const problems = mainBusinessProblems(profile);
  if (problems.length > 0) {
    parts.push(`Solving problems like: ${problems.join("; ")}`);
  } else {
    const useCases = mainUseCaseNames(profile);
    if (useCases.length > 0) {
      parts.push(`Primary use cases: ${useCases.join("; ")}`);
    }
  }

  if (parts.length === 0) {
    let host = "this product";
    try {
      host = new URL(subjectUrl).hostname.replace(/^www\./, "");
    } catch {
      /* ignore */
    }
    return `Companies and startups competing with ${host} — similar product category and target customers`;
  }

  return `Companies and startups competing with or alternative to: ${parts.join(". ")}`;
}
