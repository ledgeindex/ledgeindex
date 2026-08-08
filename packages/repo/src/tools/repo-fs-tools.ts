import fs from "node:fs";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

function resolveSafe(repoRoot: string, relativePath: string): string {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, relativePath || ".");
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes repo root: ${relativePath}`);
  }
  return target;
}

function toPosixRel(repoRoot: string, abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join("/") || ".";
}

/**
 * Read-only filesystem tools scoped to a repo root (plain createTool — not Mastra Workspace).
 */
export function createRepoFsTools(repoRoot: string) {
  const root = path.resolve(repoRoot);

  const list_dir = createTool({
    id: "list_dir",
    description:
      "List files and directories under a relative path in the repo (default: root).",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Relative directory path, default '.'"),
    }),
    outputSchema: z.object({
      path: z.string(),
      entries: z.array(
        z.object({
          name: z.string(),
          type: z.enum(["file", "dir"]),
        }),
      ),
    }),
    execute: async (input) => {
      const dir = resolveSafe(root, input.path?.trim() || ".");
      const names = fs.readdirSync(dir, { withFileTypes: true });
      return {
        path: toPosixRel(root, dir),
        entries: names
          .filter((d) => d.name !== ".git" && d.name !== "node_modules")
          .map((d) => ({
            name: d.name,
            type: d.isDirectory() ? ("dir" as const) : ("file" as const),
          })),
      };
    },
  });

  const read_file = createTool({
    id: "read_file",
    description: "Read a text file from the repo (relative path).",
    inputSchema: z.object({
      path: z.string().describe("Relative file path, e.g. README.md"),
      max_chars: z
        .number()
        .optional()
        .describe("Optional truncate length (default 12000)"),
    }),
    outputSchema: z.object({
      path: z.string(),
      content: z.string(),
      truncated: z.boolean(),
    }),
    execute: async (input) => {
      const file = resolveSafe(root, input.path);
      const st = fs.statSync(file);
      if (!st.isFile()) throw new Error(`Not a file: ${input.path}`);
      const max = input.max_chars ?? 12_000;
      const raw = fs.readFileSync(file, "utf8");
      const truncated = raw.length > max;
      return {
        path: toPosixRel(root, file),
        content: truncated ? `${raw.slice(0, max)}\n…[truncated]` : raw,
        truncated,
      };
    },
  });

  const grep_repo = createTool({
    id: "grep_repo",
    description:
      "Search file contents under the repo for a literal or simple substring (case-insensitive).",
    inputSchema: z.object({
      query: z.string().min(1),
      path: z
        .string()
        .optional()
        .describe("Optional relative subdirectory to limit search"),
      max_hits: z.number().optional(),
    }),
    outputSchema: z.object({
      hits: z.array(
        z.object({
          path: z.string(),
          line: z.number(),
          text: z.string(),
        }),
      ),
    }),
    execute: async (input) => {
      const start = resolveSafe(root, input.path?.trim() || ".");
      const q = input.query.toLowerCase();
      const maxHits = input.max_hits ?? 30;
      const hits: Array<{ path: string; line: number; text: string }> = [];
      const skip = new Set([".git", "node_modules", "dist", "build", ".next"]);

      const walk = (dir: string) => {
        if (hits.length >= maxHits) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ent of entries) {
          if (hits.length >= maxHits) return;
          if (skip.has(ent.name)) continue;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            walk(full);
            continue;
          }
          if (!/\.(md|mdx|ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|txt)$/i.test(ent.name)) {
            continue;
          }
          let text: string;
          try {
            text = fs.readFileSync(full, "utf8");
          } catch {
            continue;
          }
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i += 1) {
            if (hits.length >= maxHits) return;
            const line = lines[i]!;
            if (line.toLowerCase().includes(q)) {
              hits.push({
                path: toPosixRel(root, full),
                line: i + 1,
                text: line.slice(0, 240),
              });
            }
          }
        }
      };

      walk(start);
      return { hits };
    },
  });

  return { list_dir, read_file, grep_repo };
}

export type RepoFsTools = ReturnType<typeof createRepoFsTools>;
