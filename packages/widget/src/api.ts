export type WidgetConfig = {
  websiteId: string;
  apiBaseUrl: string;
  projectName: string;
  projectColor: string;
  projectLogo: string | null;
  exampleQuestions: string[];
};

export type WidgetCitation = {
  name: string;
  url: string;
};

export type WidgetChatResponse = {
  answer: string;
  citations: WidgetCitation[];
  insufficient?: boolean;
  error?: string;
};

export type AskWidgetHandlers = {
  onToken: (text: string) => void;
};

type WidgetSseEvent =
  | { type: "token"; text: string }
  | {
      type: "done";
      citations?: WidgetCitation[];
      insufficient?: boolean;
    }
  | { type: "error"; error: string };

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function readConfigFromScript(script: HTMLScriptElement): WidgetConfig {
  const dataset = script.dataset;
  const apiBase =
    dataset.apiBaseUrl?.trim() ||
    dataset.apiUrl?.trim() ||
    "http://localhost:3010";

  const examplesRaw = dataset.exampleQuestions?.trim() ?? "";
  const exampleQuestions = examplesRaw
    ? examplesRaw
        .split("|")
        .map((q) => q.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    websiteId: dataset.websiteId?.trim() || "",
    apiBaseUrl: trimSlash(apiBase),
    projectName: dataset.projectName?.trim() || "Ask AI",
    projectColor: dataset.projectColor?.trim() || "#6b5a3e",
    projectLogo: dataset.projectLogo?.trim() || null,
    exampleQuestions,
  };
}

function parseSseChunk(
  buffer: string,
  onEvent: (event: WidgetSseEvent) => void,
): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const dataLines = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const raw = dataLines.join("\n");
    if (!raw || raw === "[DONE]") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "type" in parsed &&
        typeof (parsed as { type: unknown }).type === "string"
      ) {
        onEvent(parsed as WidgetSseEvent);
      }
    } catch {
      // Ignore malformed frames mid-stream.
    }
  }
  return rest;
}

/** Stream widget chat over SSE (`token` → `done` / `error`). */
export async function askWidgetStream(
  config: WidgetConfig,
  message: string,
  handlers: AskWidgetHandlers,
): Promise<WidgetChatResponse> {
  const res = await fetch(`${config.apiBaseUrl}/api/widget/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      websiteId: config.websiteId,
      message,
    }),
  });

  const contentType = res.headers.get("content-type") ?? "";

  // Validation / auth errors still return JSON before the SSE hijack.
  if (!contentType.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string | { formErrors?: string[] };
    };
    const err =
      typeof data.error === "string"
        ? data.error
        : `Widget chat failed (${res.status})`;
    throw new Error(err);
  }

  if (!res.ok || !res.body) {
    throw new Error(`Widget chat failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let citations: WidgetCitation[] = [];
  let insufficient = false;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseChunk(buffer, (event) => {
      if (event.type === "token" && event.text) {
        answer += event.text;
        handlers.onToken(event.text);
        return;
      }
      if (event.type === "done") {
        citations = Array.isArray(event.citations) ? event.citations : [];
        insufficient = Boolean(event.insufficient);
        return;
      }
      if (event.type === "error") {
        streamError = event.error || "Stream failed";
      }
    });
  }

  // Flush trailing frame if the connection closed without a final blank line.
  if (buffer.trim()) {
    parseSseChunk(`${buffer}\n\n`, (event) => {
      if (event.type === "token" && event.text) {
        answer += event.text;
        handlers.onToken(event.text);
      } else if (event.type === "done") {
        citations = Array.isArray(event.citations) ? event.citations : [];
        insufficient = Boolean(event.insufficient);
      } else if (event.type === "error") {
        streamError = event.error || "Stream failed";
      }
    });
  }

  if (streamError) {
    throw new Error(streamError);
  }

  return {
    answer,
    citations,
    insufficient,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
