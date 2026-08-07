import type { NextConfig } from "next";
import { existsSync } from "node:fs";
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

// NEXT_PUBLIC_* is inlined into the browser bundle at build time. Without it,
// @ledgeindex/client falls back to http://localhost:3010 (broken on ledgeindex.com).
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
  transpilePackages: ["@ledgeindex/client"],
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
