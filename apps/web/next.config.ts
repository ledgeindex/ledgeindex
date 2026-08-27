import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
/** LedgeIndex monorepo root (packages/, hosts/) — only present in local workspace. */
const ledgeindexRoot = path.join(projectRoot, "../..");
/** npm workspaces may hoist deps to the monorepo root; Turbopack must see that tree */
const monorepoRoot = path.join(ledgeindexRoot, "..");
const ledgeindexClientSrc = path.join(
  ledgeindexRoot,
  "packages/client/src/index.ts",
);
const hasLocalClient = existsSync(ledgeindexClientSrc);
const appVersion = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
).version as string;

// NEXT_PUBLIC_* is inlined into the browser bundle at build time. Without it,
// @ledgeindex/client falls back to localhost in development only.
if (process.env.NODE_ENV === "production") {
  const apiUrl =
    process.env.NEXT_PUBLIC_LEDGEINDEX_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL?.trim() ||
    "";
  if (!apiUrl || /localhost|127\.0\.0\.1/i.test(apiUrl)) {
    throw new Error(
      "Production build requires NEXT_PUBLIC_LEDGEINDEX_API_URL (non-localhost). " +
        "Docker: pass DOTENV_KEY as a build-arg so dotenv vault loads before `next build`.",
    );
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  typescript: {
    // Match Pindown frontend — `next build` must not fail on tsc diagnostics.
    ignoreBuildErrors: true,
  },
  transpilePackages: ["@ledgeindex/client"],
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
  ...(hasLocalClient
    ? {
        turbopack: {
          root: monorepoRoot,
          resolveAlias: {
            "@ledgeindex/client": "ledgeindex/packages/client/src/index.ts",
          },
        },
        webpack: (config: { resolve?: { alias?: Record<string, string> } }) => {
          config.resolve ??= {};
          config.resolve.alias ??= {};
          config.resolve.alias["@ledgeindex/client"] = ledgeindexClientSrc;
          return config;
        },
      }
    : {}),
};

export default nextConfig;
