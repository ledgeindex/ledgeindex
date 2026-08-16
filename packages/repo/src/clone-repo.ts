import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataPath } from "@ledgeindex/core/lib/data-dir.js";
import { logInfo, logVerbose } from "@ledgeindex/core/lib/logger.js";

/**
 * Shallow clone of a public repository so a source can be indexed from a URL.
 *
 * Uses the git CLI rather than a library: a shallow single-branch clone is two
 * commands, and every deployment target that can index a repo already has git.
 */

const execFileAsync = promisify(execFile);

/** Repositories are large; a clone on a cold cache can legitimately take a while. */
const GIT_TIMEOUT_MS = 10 * 60 * 1000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Anything git could read as an option or a transport we do not want. The URL
 * reaches git as an argv entry, never a shell string, so this is about refusing
 * `--upload-pack=`, `ext::`, and local paths rather than about quoting.
 */
const HTTPS_REPO_URL = /^https:\/\/[a-z0-9.-]+\/[\w.-]+\/[\w.-]+?(?:\.git)?$/i;
/** Branch, tag, or commit. Excludes anything git would treat as an option or a path trick. */
const SAFE_REF = /^[\w][\w./-]*$/;

export type CloneRepoInput = {
  /** Repository URL, e.g. `https://github.com/owner/repo`. A `/tree/<ref>` suffix sets the ref. */
  repoUrl: string;
  /** Branch, tag, or commit. Defaults to the remote's default branch. */
  ref?: string | null;
  /** Where to place the checkout. Defaults to a cache directory under the data dir. */
  targetDir?: string;
  /** Re-clone from scratch instead of fetching into an existing checkout. */
  fresh?: boolean;
};

export type CloneRepoResult = {
  checkoutPath: string;
  /** Normalized `https://host/owner/repo`, suitable as `githubUrl`. */
  repoUrl: string;
  ref: string | null;
  commitSha: string;
  /** True when an existing checkout was updated rather than cloned. */
  reused: boolean;
};

export class CloneRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneRepoError";
  }
}

/** Strip a `/tree/<ref>` or `/blob/<ref>/...` suffix and normalize to host/owner/repo. */
export function parseRepoUrl(input: string): {
  repoUrl: string;
  host: string;
  owner: string;
  repo: string;
  ref: string | null;
} {
  const raw = input.trim();
  if (!raw) throw new CloneRepoError("Repository URL is required");

  let parsed: URL;
  try {
    parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new CloneRepoError(`Not a URL: ${input}`);
  }
  if (parsed.protocol !== "https:") {
    throw new CloneRepoError(
      `Only https repository URLs are supported, got ${parsed.protocol}`,
    );
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const [owner, repoSegment, kind, ...rest] = segments;
  if (!owner || !repoSegment) {
    throw new CloneRepoError(
      `Expected https://host/owner/repo, got ${parsed.pathname}`,
    );
  }

  const repo = repoSegment.replace(/\.git$/i, "");
  const ref =
    (kind === "tree" || kind === "blob") && rest[0] ? rest[0] : null;
  const repoUrl = `https://${parsed.host}/${owner}/${repo}`;

  if (!HTTPS_REPO_URL.test(repoUrl)) {
    throw new CloneRepoError(`Refusing unsafe repository URL: ${repoUrl}`);
  }
  if (ref && !SAFE_REF.test(ref)) {
    throw new CloneRepoError(`Refusing unsafe git ref: ${ref}`);
  }

  return { repoUrl, host: parsed.host, owner, repo, ref };
}

/** Stable cache location for a repository, so a re-index fetches instead of re-cloning. */
export function repoCheckoutCachePath(repoUrl: string): string {
  const { host, owner, repo } = parseRepoUrl(repoUrl);
  const slug = [host, owner, repo]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return dataPath("repo-checkouts", slug);
}

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      env: {
        ...process.env,
        // Fail on a private repo instead of blocking on a credential prompt.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        GCM_INTERACTIVE: "never",
      },
    });
    return stdout.trim();
  } catch (error) {
    const details = error as { code?: string; stderr?: string; message?: string };
    if (details.code === "ENOENT") {
      throw new CloneRepoError(
        "git was not found on PATH — install git to index a repository from a URL",
      );
    }
    const stderr = details.stderr?.trim();
    throw new CloneRepoError(
      `git ${args[0]} failed: ${stderr || details.message || "unknown error"}`,
    );
  }
}

export async function cloneRepo(
  input: CloneRepoInput,
): Promise<CloneRepoResult> {
  const parsed = parseRepoUrl(input.repoUrl);
  const ref = input.ref?.trim() || parsed.ref;
  if (ref && !SAFE_REF.test(ref)) {
    throw new CloneRepoError(`Refusing unsafe git ref: ${ref}`);
  }

  const checkoutPath = input.targetDir
    ? input.targetDir
    : repoCheckoutCachePath(parsed.repoUrl);

  if (input.fresh && existsSync(checkoutPath)) {
    rmSync(checkoutPath, { recursive: true, force: true });
  }

  const reused = existsSync(join(checkoutPath, ".git"));

  if (reused) {
    logVerbose("Updating cached checkout", "CloneRepo", {
      repoUrl: parsed.repoUrl,
      checkoutPath,
      ref: ref ?? "(default)",
    });
    await git(
      ["fetch", "--depth", "1", "origin", ...(ref ? [ref] : ["HEAD"])],
      checkoutPath,
    );
    await git(["reset", "--hard", "FETCH_HEAD"], checkoutPath);
    await git(["clean", "-fdx"], checkoutPath);
  } else {
    mkdirSync(checkoutPath, { recursive: true });
    logInfo("Cloning repository", "CloneRepo", {
      repoUrl: parsed.repoUrl,
      checkoutPath,
      ref: ref ?? "(default)",
    });
    await git([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      ...(ref ? ["--branch", ref] : []),
      "--",
      parsed.repoUrl,
      checkoutPath,
    ]);
  }

  const commitSha = await git(["rev-parse", "HEAD"], checkoutPath);

  logInfo("Checkout ready", "CloneRepo", {
    repoUrl: parsed.repoUrl,
    commitSha: commitSha.slice(0, 12),
    reused,
  });

  return { checkoutPath, repoUrl: parsed.repoUrl, ref, commitSha, reused };
}
