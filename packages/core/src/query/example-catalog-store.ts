import { readFileSync, writeFileSync } from "node:fs";
import { dataPath } from "../lib/data-dir.js";
import type { ExampleCatalog } from "./example-catalog.js";

const CATALOG_FILE = dataPath("example-catalogs.json");

type Snapshot = Record<string, ExampleCatalog>;

function loadSnapshot(): Snapshot {
  try {
    return JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as Snapshot;
  } catch {
    return {};
  }
}

function persistSnapshot(snapshot: Snapshot) {
  writeFileSync(CATALOG_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function getExampleCatalog(
  sourceId: string,
): Promise<ExampleCatalog | null> {
  return loadSnapshot()[sourceId] ?? null;
}

export async function saveExampleCatalog(
  sourceId: string,
  catalog: ExampleCatalog,
): Promise<ExampleCatalog> {
  const snapshot = loadSnapshot();
  snapshot[sourceId] = catalog;
  persistSnapshot(snapshot);
  return catalog;
}

export async function deleteExampleCatalog(sourceId: string): Promise<void> {
  const snapshot = loadSnapshot();
  if (!(sourceId in snapshot)) return;
  delete snapshot[sourceId];
  persistSnapshot(snapshot);
}
