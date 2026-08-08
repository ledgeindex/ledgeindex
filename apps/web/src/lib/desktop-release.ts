/** Public GitHub repo that publishes desktop installers (`desktop-v*` tags). */
export const DESKTOP_GITHUB_REPO = "ledgeindex/ledgeindex";

export type DesktopWindowsRelease = {
  version: string;
  tag: string;
  downloadUrl: string;
  releasesPageUrl: string;
};

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

function releaseFromGitHub(release: GitHubRelease): DesktopWindowsRelease | null {
  const tag = String(release.tag_name ?? "");
  if (!tag.startsWith("desktop-v")) return null;

  const asset = (release.assets ?? []).find(
    (item) => typeof item.name === "string" && isWindowsSetupAsset(item.name),
  );
  if (!asset?.browser_download_url) return null;

  return {
    version: tag.replace(/^desktop-v/, ""),
    tag,
    downloadUrl: asset.browser_download_url,
    releasesPageUrl: `https://github.com/${DESKTOP_GITHUB_REPO}/releases/tag/${encodeURIComponent(tag)}`,
  };
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

/**
 * Resolves the newest published desktop Windows installer from GitHub Releases.
 * Picks the highest `desktop-v*` semver that has a `*-setup.exe` asset.
 */
export async function getLatestDesktopWindowsRelease(): Promise<DesktopWindowsRelease | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${DESKTOP_GITHUB_REPO}/releases?per_page=30`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "ledgeindex-web",
        },
        next: { revalidate: 3600 },
      },
    );
    if (!response.ok) return null;

    const releases = (await response.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) return null;

    let best: DesktopWindowsRelease | null = null;
    for (const release of releases) {
      if (release.draft || release.prerelease) continue;
      const resolved = releaseFromGitHub(release);
      if (!resolved) continue;
      if (!best || compareDesktopVersions(resolved.version, best.version) > 0) {
        best = resolved;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** Fallback when the API is unavailable: GitHub’s latest release page. */
export const DESKTOP_RELEASES_FALLBACK_URL = `https://github.com/${DESKTOP_GITHUB_REPO}/releases/latest`;
