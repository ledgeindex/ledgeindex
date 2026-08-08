/** Public GitHub repo that publishes desktop installers (`desktop-v*` tags). */
export const DESKTOP_GITHUB_REPO = "ledgeindex/ledgeindex";

export type DesktopReleaseAsset = {
  version: string;
  tag: string;
  downloadUrl: string;
  releasesPageUrl: string;
};

/** @deprecated Prefer DesktopReleaseAsset — kept for existing call sites. */
export type DesktopWindowsRelease = DesktopReleaseAsset;

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubRelease = {
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
};

function isWindowsSetupAsset(name: string): boolean {
  return name.endsWith("-setup.exe") && !name.endsWith(".blockmap");
}

function isMacDmgAsset(name: string): boolean {
  return (
    name.endsWith(".dmg") &&
    !name.endsWith(".blockmap") &&
    name.includes("-mac-")
  );
}

function macAssetRank(name: string): number {
  // Prefer Apple Silicon for the marketing primary link.
  if (name.includes("-arm64.")) return 2;
  if (name.includes("-x64.")) return 1;
  return 0;
}

function releasePageUrl(tag: string): string {
  return `https://github.com/${DESKTOP_GITHUB_REPO}/releases/tag/${encodeURIComponent(tag)}`;
}

function versionParts(version: string): number[] {
  return version.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Compare dotted versions like `0.1.12` vs `0.1.9`. */
export function compareDesktopVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function listDesktopReleases(): Promise<GitHubRelease[]> {
  const response = await fetch(
    `https://api.github.com/repos/${DESKTOP_GITHUB_REPO}/releases?per_page=30`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ledgeindex-web",
      },
      // Next.js fetch cache hint — ignored outside the App Router runtime.
      ...({ next: { revalidate: 3600 } } as RequestInit),
    },
  );
  if (!response.ok) return [];
  const releases = (await response.json()) as GitHubRelease[];
  return Array.isArray(releases) ? releases : [];
}

function pickBestAsset(
  releases: GitHubRelease[],
  match: (name: string) => boolean,
  rank?: (name: string) => number,
): DesktopReleaseAsset | null {
  let best: DesktopReleaseAsset | null = null;
  let bestRank = -1;

  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const tag = String(release.tag_name ?? "");
    if (!tag.startsWith("desktop-v")) continue;

    const candidates = (release.assets ?? []).filter(
      (item) =>
        typeof item.name === "string" &&
        match(item.name) &&
        Boolean(item.browser_download_url),
    );
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => (rank?.(b.name!) ?? 0) - (rank?.(a.name!) ?? 0));
    const asset = candidates[0]!;
    const assetRank = rank?.(asset.name!) ?? 0;
    const resolved: DesktopReleaseAsset = {
      version: tag.replace(/^desktop-v/, ""),
      tag,
      downloadUrl: asset.browser_download_url!,
      releasesPageUrl: releasePageUrl(tag),
    };

    if (
      !best ||
      compareDesktopVersions(resolved.version, best.version) > 0 ||
      (compareDesktopVersions(resolved.version, best.version) === 0 &&
        assetRank > bestRank)
    ) {
      best = resolved;
      bestRank = assetRank;
    }
  }

  return best;
}

/**
 * Newest published Windows installer (`*-setup.exe`) from GitHub Releases.
 */
export async function getLatestDesktopWindowsRelease(): Promise<DesktopReleaseAsset | null> {
  try {
    return pickBestAsset(await listDesktopReleases(), isWindowsSetupAsset);
  } catch {
    return null;
  }
}

/**
 * Newest published macOS DMG from GitHub Releases (prefers Apple Silicon).
 */
export async function getLatestDesktopMacRelease(): Promise<DesktopReleaseAsset | null> {
  try {
    return pickBestAsset(
      await listDesktopReleases(),
      isMacDmgAsset,
      macAssetRank,
    );
  } catch {
    return null;
  }
}

/** Fallback when the API is unavailable: GitHub’s latest release page. */
export const DESKTOP_RELEASES_FALLBACK_URL = `https://github.com/${DESKTOP_GITHUB_REPO}/releases/latest`;
