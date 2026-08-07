const STORAGE_PREFIX = "knowledgeindex:playground-provisioned:";

export function isPlaygroundKeyProvisioned(uid: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${uid}`) === "1";
  } catch {
    return false;
  }
}

export function markPlaygroundKeyProvisioned(uid: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${uid}`, "1");
  } catch {
    // ignore quota / private mode
  }
}
