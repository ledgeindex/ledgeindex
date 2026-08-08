/**
 * Canonical page URL for a repo file — must be a valid https URL for
 * index-preview / chunk metadata path derivation.
 */
export function repoFileCanonicalUrl(input: {
  relativePath: string;
  githubUrl?: string | null;
  sourceSlug?: string | null;
}): string {
  const relative = input.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const encoded = relative
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const github = input.githubUrl?.trim();
  if (github) {
    const match = github.match(
      /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i,
    );
    if (match) {
      const owner = match[1]!;
      const repo = match[2]!;
      return `https://github.com/${owner}/${repo}/blob/HEAD/${encoded}`;
    }
  }

  const slug =
    input.sourceSlug?.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "repo";
  return `https://repo.ledgeindex.local/${encodeURIComponent(slug)}/${encoded}`;
}

export function githubHttpsUrlFromCloneUrl(githubUrl: string): string | null {
  const match = githubUrl
    .trim()
    .match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

export function repoSourceSlugFromGithubUrl(githubUrl: string): string {
  const match = githubUrl
    .trim()
    .match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) return "repo";
  const owner = match[1]!.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const repo = match[2]!.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return `repo-${owner}-${repo}`.slice(0, 64);
}
