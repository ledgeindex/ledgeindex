import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SystemBrowserInfo = {
  label: string;
  path: string;
  kind: "chrome" | "edge" | "chromium";
};

function isExecutable(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return existsSync(path);
  }
}

function firstExecutable(
  candidates: Array<{ path: string; label: string; kind: SystemBrowserInfo["kind"] }>,
): SystemBrowserInfo | null {
  for (const candidate of candidates) {
    if (isExecutable(candidate.path)) {
      return {
        label: candidate.label,
        path: candidate.path,
        kind: candidate.kind,
      };
    }
  }
  return null;
}

function envOverride(): SystemBrowserInfo | null {
  const fromEnv =
    process.env.LEDGEINDEX_CHROME_EXECUTABLE?.trim() ||
    process.env.CHROME_PATH?.trim();
  if (!fromEnv || !isExecutable(fromEnv)) return null;
  const lower = fromEnv.toLowerCase();
  const kind: SystemBrowserInfo["kind"] = lower.includes("msedge")
    ? "edge"
    : lower.includes("chromium")
      ? "chromium"
      : "chrome";
  const label =
    kind === "edge"
      ? "Microsoft Edge"
      : kind === "chromium"
        ? "Chromium"
        : "Google Chrome";
  return { label, path: fromEnv, kind };
}

function detectWindows(): SystemBrowserInfo | null {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  return firstExecutable([
    {
      path: join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      label: "Google Chrome",
      kind: "chrome",
    },
    {
      path: join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      label: "Google Chrome",
      kind: "chrome",
    },
    {
      path: join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      label: "Google Chrome",
      kind: "chrome",
    },
    {
      path: join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      label: "Microsoft Edge",
      kind: "edge",
    },
    {
      path: join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      label: "Microsoft Edge",
      kind: "edge",
    },
  ]);
}

function detectMac(): SystemBrowserInfo | null {
  return firstExecutable([
    {
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      label: "Google Chrome",
      kind: "chrome",
    },
    {
      path: join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      label: "Google Chrome",
      kind: "chrome",
    },
    {
      path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
      label: "Chromium",
      kind: "chromium",
    },
    {
      path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      label: "Microsoft Edge",
      kind: "edge",
    },
  ]);
}

function detectLinux(): SystemBrowserInfo | null {
  return firstExecutable([
    { path: "/usr/bin/google-chrome-stable", label: "Google Chrome", kind: "chrome" },
    { path: "/usr/bin/google-chrome", label: "Google Chrome", kind: "chrome" },
    { path: "/usr/bin/chromium-browser", label: "Chromium", kind: "chromium" },
    { path: "/usr/bin/chromium", label: "Chromium", kind: "chromium" },
    { path: "/snap/bin/chromium", label: "Chromium", kind: "chromium" },
  ]);
}

/** Installed Chrome / Edge / Chromium on the machine running the API. */
export function detectSystemBrowser(): SystemBrowserInfo | null {
  const override = envOverride();
  if (override) return override;

  switch (process.platform) {
    case "win32":
      return detectWindows();
    case "darwin":
      return detectMac();
    default:
      return detectLinux();
  }
}
