import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Writable data dir — always under cwd so bundled dist/server.js paths stay valid on Cloud Run. */
export function getDataDir(): string {
  const dir = process.env.LEDGEINDEX_DATA_DIR ?? join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataPath(...segments: string[]): string {
  return join(getDataDir(), ...segments);
}
