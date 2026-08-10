#!/usr/bin/env node
/**
 * Sync Source updater catalog from the single docs list:
 *   top-typescript-docs.json
 * → apps/web/public/data/typescript-docs-catalog.json
 *
 * Usage:
 *   node scripts/sync-typescript-docs-catalog.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {
    input: path.join(root, "top-typescript-docs.json"),
    excludesGlob: null,
    out: path.join(root, "apps/web/public/data/typescript-docs-catalog.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" || arg === "--categorized") out.input = path.resolve(argv[++i]);
    else if (arg === "--excludes-glob") out.excludesGlob = argv[++i];
    else if (arg === "--out") out.out = path.resolve(argv[++i]);
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeVersions(versions) {
  const list = asArray(versions)
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (list.length === 0) return ["latest"];
  if (!list.includes("latest")) return ["latest", ...list];
  return list;
}

function packageKey(entry) {
  return String(entry?.package || entry?.name || "").trim();
}

function matchExcludeGlob(excludesGlob) {
  if (!excludesGlob) {
    // Default: any docs-exclude-*.patterns.json / *.json in ledgeindex root
    return readdirSync(root)
      .filter((name) => /^docs-exclude-.*\.patterns\.json$/i.test(name))
      .map((name) => path.join(root, name));
  }
  // Simple suffix/prefix glob: 'docs-exclude-*.patterns.json'
  const star = excludesGlob.indexOf("*");
  if (star < 0) {
    const abs = path.resolve(root, excludesGlob);
    return existsSync(abs) ? [abs] : [];
  }
  const prefix = excludesGlob.slice(0, star);
  const suffix = excludesGlob.slice(star + 1);
  return readdirSync(root)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => path.join(root, name));
}

function loadExcludesByStartUrl(files) {
  const map = new Map();
  for (const file of files) {
    try {
      const data = readJson(file);
      const startUrl = String(data.startUrl || "").replace(/\/+$/, "");
      if (!startUrl) continue;
      map.set(startUrl, {
        excludePatterns: asArray(data.excludePatterns),
        patternsAreRegex: Boolean(data.patternsAreRegex),
        versions: normalizeVersions(data.versions),
      });
    } catch (err) {
      console.warn(`skip exclude file ${file}:`, err.message);
    }
  }
  return map;
}

function normalizeDocsUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).replace(/\/+$/, "");
  }
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.input)) {
  console.error(`Missing docs list: ${args.input}`);
  process.exit(1);
}

const source = readJson(args.input);
const sourceEntries = Array.isArray(source)
  ? source
  : asArray(source.entries);
const excludeFiles = matchExcludeGlob(args.excludesGlob);
const excludesByStart = loadExcludesByStartUrl(excludeFiles);

const entries = sourceEntries.map((raw, index) => {
  const pkg = packageKey(raw) || `unknown-${index}`;
  const docs = raw.docsUrl || raw.docs || null;
  const apiReferenceUrls = asArray(raw.apiReferenceUrls).filter(Boolean);
  const paths = asArray(raw.paths)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const url = String(row.url || "").trim();
      if (!url) return null;
      const kind = String(row.kind || "other");
      const label = row.label ? String(row.label) : undefined;
      return label ? { kind, url, label } : { kind, url };
    })
    .filter(Boolean);
  const startUrls = asArray(raw.startUrls).filter(Boolean);
  const docsKey = normalizeDocsUrl(docs);
  const excludeHit = docsKey ? excludesByStart.get(docsKey) : null;

  const versions = normalizeVersions(
    excludeHit?.versions ?? raw.versions ?? ["latest"],
  );
  const selectedVersion =
    versions.includes(raw.selectedVersion) && raw.selectedVersion
      ? raw.selectedVersion
      : versions[0];

  return {
    package: pkg,
    category: raw.category || "uncategorized",
    docs: docs || null,
    apiReferenceUrls,
    paths,
    startUrls:
      startUrls.length > 0 ? startUrls : paths.map((p) => p.url).filter(Boolean),
    pathsStatus: raw.pathsStatus || null,
    pathsReason: raw.pathsReason || null,
    excludePatterns: excludeHit
      ? excludeHit.excludePatterns
      : asArray(raw.excludePatterns),
    patternsAreRegex: excludeHit
      ? excludeHit.patternsAreRegex
      : Boolean(raw.patternsAreRegex),
    versions,
    selectedVersion,
    docsStatus: raw.docsStatus || (docs ? "present" : null),
    isRedirect: raw.isRedirect ?? null,
    finalDocsUrl: raw.finalDocsUrl ?? null,
    redirectUncrawlable: raw.redirectUncrawlable ?? null,
    description: raw.description ?? null,
    homepage: raw.homepage ?? null,
    github: raw.github ?? raw.repository ?? null,
    downloadsLastMonth:
      raw.downloadsLastMonth ?? raw.downloads ?? raw.npmDownloads ?? null,
    rank: raw.rank ?? index + 1,
    docsDomain: raw.docsDomain ?? null,
    openPageRank:
      raw.openPageRank == null || Number.isNaN(Number(raw.openPageRank))
        ? null
        : Number(raw.openPageRank),
    openPageRankGlobalRank:
      raw.openPageRankGlobalRank == null ||
      Number.isNaN(Number(raw.openPageRankGlobalRank))
        ? null
        : Number(raw.openPageRankGlobalRank),
    referringDomains:
      raw.referringDomains == null ||
      Number.isNaN(Number(raw.referringDomains))
        ? null
        : Number(raw.referringDomains),
    oprRank:
      raw.oprRank == null || Number.isNaN(Number(raw.oprRank))
        ? null
        : Number(raw.oprRank),
  };
});

const payload = {
  generatedAt: new Date().toISOString(),
  source: path.basename(args.input),
  excludeSources: excludeFiles.map((f) => path.basename(f)),
  count: entries.length,
  entries,
};

mkdirSync(path.dirname(args.out), { recursive: true });
writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`);

const withDocs = entries.filter((e) => e.docs).length;
const withExcludes = entries.filter((e) => e.excludePatterns.length > 0).length;
const withPaths = entries.filter((e) => e.paths.length > 0).length;
const withOpr = entries.filter((e) => e.openPageRank != null).length;
const multiVersion = entries.filter((e) => e.versions.length > 1).length;

console.log(
  JSON.stringify(
    {
      out: args.out,
      count: entries.length,
      withDocs,
      withPaths,
      withOpr,
      withExcludes,
      multiVersion,
      excludeFiles: excludeFiles.map((f) => path.basename(f)),
    },
    null,
    2,
  ),
);
