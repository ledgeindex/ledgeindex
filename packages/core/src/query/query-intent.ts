/**
 * LlamaIndex-style fusion query list: always include the cleaned user question,
 * then generated NL variants (deduped, case-insensitive).
 */
export function mergeFusionQueries(
  question: string,
  generated: string[],
): string[] {
  const cleaned = cleanQuestionForRetrieve(question);
  const original = question.trim();
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  add(cleaned);
  if (original && original.toLowerCase() !== cleaned.toLowerCase()) {
    add(original);
  }
  for (const query of generated) add(query);
  return out;
}

/** Strip code fences and normalize whitespace for hybrid retrieve / rerank fallback. */
export function cleanQuestionForRetrieve(question: string): string {
  const withoutCode = question
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutCode) return question.trim().slice(0, 400);
  return withoutCode.slice(0, 400);
}

/** Short natural-language fallback when structured rewrite is unavailable. */
export function fallbackIntentForRerank(question: string): string {
  const cleaned = cleanQuestionForRetrieve(question);
  if (!cleaned) return question.trim().slice(0, 200);
  return cleaned.slice(0, 200);
}

/** Escalation rerank phrase when the primary rerank query scores nothing. */
export function escalationRerankFromQuestion(question: string): string {
  const cleaned = cleanQuestionForRetrieve(question);
  if (!cleaned) return "";
  if (cleaned.includes("?")) return cleaned.slice(0, 200);
  return `What is ${cleaned}?`.slice(0, 200);
}

/** Lightweight keyword tokens for BM25 fallback (no LLM). */
export function fallbackKeywordsFromQuestion(question: string): string[] {
  const cleaned = cleanQuestionForRetrieve(question).toLowerCase();
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_.-]/gi, ""))
    .filter((t) => t.length >= 3);
  return [...new Set(tokens)].slice(0, 10);
}

const MAX_RERANK_QUERY_CHARS = 220;
const BOILERPLATE_CODE_LINE =
  /^\s*(import\s+|from\s+.+\s+import|#|\/\/|\/\*|\*\s|const\s+\w+\s*=\s*require\()/i;

/** Error or traceback line from the raw user message (not keyword tokens). */
export function extractErrorSnippet(question: string): string | undefined {
  for (const line of question.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      /\b(Error|Exception|Traceback|SyntaxError|KeyError|TypeError|ValueError|AttributeError)\b/.test(
        trimmed,
      )
    ) {
      return trimmed.slice(0, 120);
    }
  }

  const inline = question.match(
    /\b[A-Z][a-zA-Z]*Error(?::\s*[^\n]{0,80})?/,
  );
  if (inline) return inline[0].slice(0, 120);
  return undefined;
}

/** 1–3 non-boilerplate lines from a code fence or inline backticks. */
export function extractCodeSnippet(question: string): string | undefined {
  const fence = question.match(/```[\w-]*\n([\s\S]{8,500}?)\n```/);
  if (fence) {
    const lines = fence[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !BOILERPLATE_CODE_LINE.test(line));
    const condensed = lines.slice(0, 3).join(" ").replace(/\s+/g, " ").trim();
    if (condensed.length >= 8) return condensed.slice(0, 100);
  }

  const inline = question.match(/`([^`\n]{8,80})`/);
  if (inline) return inline[1].trim();
  return undefined;
}

/**
 * Cross-encoder query from the user question plus trimmed error/code context.
 */
export function buildRerankQuery(input: {
  originalQuestion?: string;
}): string {
  const question = input.originalQuestion?.trim() ?? "";
  const base = question ? fallbackIntentForRerank(question) : "";

  if (!question) return base.slice(0, MAX_RERANK_QUERY_CHARS);

  const errorSnippet = extractErrorSnippet(question);
  const codeSnippet = extractCodeSnippet(question);

  const parts = [base];
  if (errorSnippet && !base.includes(errorSnippet.slice(0, 24))) {
    parts.push(`Error: ${errorSnippet}`);
  }
  if (codeSnippet && !base.includes(codeSnippet.slice(0, 20))) {
    parts.push(`Snippet: ${codeSnippet}`);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_RERANK_QUERY_CHARS);
}
