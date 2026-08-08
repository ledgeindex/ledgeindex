/** First-run product tour after sign-in (web + desktop). Bump to re-show. */
export const APP_ONBOARDING_VERSION = 5;

const STORAGE_PREFIX = "ledgeindex:onboarding:v";

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}${APP_ONBOARDING_VERSION}:${uid}`;
}

export function hasCompletedAppOnboarding(uid: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(storageKey(uid)) === "1";
  } catch {
    return true;
  }
}

export function markAppOnboardingComplete(uid: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(uid), "1");
  } catch {
    // ignore quota / private mode
  }
}

export type AppOnboardingStepId =
  | "welcome"
  | "sources"
  | "hosting"
  | "chat"
  | "start";

export type AppOnboardingStep = {
  id: AppOnboardingStepId;
  title: string;
  body: string;
};

export const APP_ONBOARDING_STEPS: readonly AppOnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to LedgeIndex",
    body: "Point LedgeIndex at your docs to build an index. Ask questions and get answers that link to the source pages.",
  },
  {
    id: "sources",
    title: "First, add a source",
    body: "Paste a docs URL and crawl it. When indexing finishes, it shows up under Sources.",
  },
  {
    id: "hosting",
    title: "Local or cloud",
    body: "Keep a source on your machine, or host it in the cloud. Same docs either way. You choose when you create it.",
  },
  {
    id: "chat",
    title: "Then chat with it",
    body: "Open a source to ask about that documentation set. In Playground you can also try ready-made collections that already exist, without indexing anything first.",
  },
  {
    id: "start",
    title: "You’re in",
    body: "Index a docs URL if you need something to search, or jump into Playground.",
  },
] as const;
