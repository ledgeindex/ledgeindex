const PROJECT_KEY = "knowledgeindex:dev-project-id";

export function getDevProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PROJECT_KEY);
}

export function setDevProjectId(projectId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECT_KEY, projectId);
}
