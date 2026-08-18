#!/usr/bin/env node
/**
 * Codesign Mach-O natives (.node / .dylib) for Apple notarization.
 *
 * Notarytool unpacks nested archives (including desktop-server.tar) and rejects
 * unsigned or un-timestamped binaries. Call this on the staged tree *before*
 * creating the tar when CSC_LINK (or a local Developer ID) is available.
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NATIVE_EXT = /\.(node|dylib)$/i;

/**
 * @param {string} dir
 * @param {string[]} out
 */
function collectMachOFiles(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      collectMachOFiles(p, out);
      continue;
    }
    if (NATIVE_EXT.test(ent.name)) out.push(p);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function parseDeveloperIdIdentity(text) {
  const match = text.match(/"(Developer ID Application: [^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * @returns {{ identity: string, cleanup: () => void } | null}
 */
function resolveSigningIdentity() {
  if (process.platform !== "darwin") return null;

  const named = process.env.CSC_NAME?.trim();
  if (named && !process.env.CSC_LINK) {
    return { identity: named, cleanup: () => {} };
  }

  const link = process.env.CSC_LINK?.trim();
  if (!link) {
    try {
      const out = execFileSync(
        "security",
        ["find-identity", "-v", "-p", "codesigning"],
        { encoding: "utf8" },
      );
      const identity = named || parseDeveloperIdIdentity(out);
      if (!identity) return null;
      return { identity, cleanup: () => {} };
    } catch {
      return null;
    }
  }

  const password = process.env.CSC_KEY_PASSWORD ?? "";
  const tmp = mkdtempSync(join(tmpdir(), "ledgeindex-csc-"));
  const p12Path = join(tmp, "cert.p12");
  const keychain = join(tmp, "signing.keychain-db");
  const keychainPassword = randomBytes(24).toString("hex");

  /** @type {Buffer} */
  let p12;
  if (link.startsWith("~/") || link.startsWith("/") || /^[A-Za-z]:\\/.test(link)) {
    p12 = readFileSync(link);
  } else if (link.startsWith("file://")) {
    p12 = readFileSync(new URL(link));
  } else if (existsSync(link)) {
    p12 = readFileSync(link);
  } else {
    p12 = Buffer.from(link.replace(/\s+/g, ""), "base64");
  }
  writeFileSync(p12Path, p12);

  const run = (cmd, args) =>
    execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  run("security", ["create-keychain", "-p", keychainPassword, keychain]);
  run("security", ["set-keychain-settings", "-lut", "21600", keychain]);
  run("security", ["unlock-keychain", "-p", keychainPassword, keychain]);
  run("security", [
    "import",
    p12Path,
    "-k",
    keychain,
    "-P",
    password,
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/security",
  ]);
  run("security", [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:,codesign:",
    "-s",
    "-k",
    keychainPassword,
    keychain,
  ]);

  // Prefer our temp keychain for identity lookup without clobbering the login keychain forever.
  const previousList = execFileSync("security", ["list-keychains", "-d", "user"], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const nextList = [keychain, ...previousList.filter((k) => k !== keychain)];
  execFileSync("security", ["list-keychains", "-d", "user", "-s", ...nextList]);

  const identities = run("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychain,
  ]);
  const identity = named || parseDeveloperIdIdentity(identities);
  if (!identity) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(
      "CSC_LINK imported but no Developer ID Application identity found in keychain",
    );
  }

  return {
    identity,
    cleanup: () => {
      try {
        execFileSync("security", ["list-keychains", "-d", "user", "-s", ...previousList]);
      } catch {
        // ignore restore failures
      }
      try {
        execFileSync("security", ["delete-keychain", keychain]);
      } catch {
        // ignore
      }
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/**
 * Sign all .node / .dylib under `dir` with Developer ID + hardened runtime + timestamp.
 *
 * @param {string} dir staged desktop-server root
 * @param {{ entitlementsPath: string, log?: (msg: string) => void, required?: boolean }} opts
 * @returns {number} number of files signed (0 if skipped)
 */
export function signDarwinMachOInDir(dir, opts) {
  const log = opts.log ?? ((msg) => console.log(`[sign-darwin-macho] ${msg}`));

  if (process.platform !== "darwin") {
    return 0;
  }
  if (!existsSync(dir)) {
    throw new Error(`signDarwinMachOInDir: missing dir ${dir}`);
  }
  if (!existsSync(opts.entitlementsPath)) {
    throw new Error(`signDarwinMachOInDir: missing entitlements ${opts.entitlementsPath}`);
  }

  const resolved = resolveSigningIdentity();
  if (!resolved) {
    if (opts.required) {
      throw new Error(
        "macOS release requires CSC_LINK (or CSC_NAME / local Developer ID) to sign " +
          "native modules inside desktop-server.tar before notarization",
      );
    }
    log("skip — no Developer ID identity (set CSC_LINK for notarized builds)");
    return 0;
  }

  const files = collectMachOFiles(dir);
  if (files.length === 0) {
    log("no .node/.dylib files found");
    resolved.cleanup();
    return 0;
  }

  log(`signing ${files.length} Mach-O binaries as ${resolved.identity}`);
  try {
    for (const file of files) {
      execFileSync(
        "codesign",
        [
          "--force",
          "--options",
          "runtime",
          "--timestamp",
          "--sign",
          resolved.identity,
          "--entitlements",
          opts.entitlementsPath,
          file,
        ],
        { stdio: "pipe" },
      );
    }
  } finally {
    resolved.cleanup();
  }

  log(`signed ${files.length} binaries`);
  return files.length;
}
