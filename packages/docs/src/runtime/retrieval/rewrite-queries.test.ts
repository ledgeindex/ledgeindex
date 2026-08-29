import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRewritePrompt,
  clipRetrievalHistoryText,
  resolveEvidenceQuestion,
} from "./rewrite-queries.js";

describe("contextual follow-up retrieval", () => {
  it("uses the context-resolved question for evidence decisions", () => {
    const resolved = resolveEvidenceQuestion("yes", [
      "Show the user the additional Mastra setup topics previously offered.",
    ]);

    assert.equal(
      resolved,
      "Show the user the additional Mastra setup topics previously offered.",
    );
    assert.notEqual(resolved, "yes");
  });

  it("preserves a follow-up offer at the end of a long assistant answer", () => {
    const assistantAnswer = `${"Mastra setup details. ".repeat(80)}
Would you like me to show deployment, Studio, and manual installation next?`;
    const clipped = clipRetrievalHistoryText(assistantAnswer);

    assert.ok(clipped.length <= 900);
    assert.match(clipped, /Mastra setup details/);
    assert.match(
      clipped,
      /Would you like me to show deployment, Studio, and manual installation next\?/,
    );
  });

  it("presents an accepted multi-topic offer as the immediate context for rewriting", () => {
    const history = `user: what is the basic setup and can you offer to show me more
assistant: To get started with Mastra, create a project or initialize an existing one.
Would you like to explore more?
- Deployment & CI/CD
- Studio Deployment
- Manual Installation`;
    const prompt = buildRewritePrompt({
      question: "yes",
      catalogText: "Get started\nServer on Mastra platform\nStudio deployment\nManual install",
      history,
    });

    assert.match(prompt, /Deployment & CI\/CD/);
    assert.match(prompt, /Studio Deployment/);
    assert.match(prompt, /Manual Installation/);
    assert.match(prompt, /<latest_user_message>\s*yes\s*<\/latest_user_message>/);
    assert.ok(
      prompt.indexOf("Would you like to explore more?") <
        prompt.indexOf("<latest_user_message>"),
    );
  });

  it("falls back to the raw question when no contextual rewrite exists", () => {
    assert.equal(resolveEvidenceQuestion("How does memory work?", []), "How does memory work?");
  });

  it("includes the compact source guide separately from the page catalog", () => {
    const prompt = buildRewritePrompt({
      question: "How do I monitor an agent?",
      history: "",
      catalogText: "Observability\nAgent tracing",
      sourceProfileHint:
        "Mastra documentation for building AI applications.\nMain topics: Agents, Workflows, Observability",
    });

    assert.match(
      prompt,
      /<source_profile>[\s\S]*Main topics: Agents, Workflows, Observability[\s\S]*<\/source_profile>/,
    );
    assert.match(
      prompt,
      /<source_catalog>[\s\S]*Observability[\s\S]*Agent tracing[\s\S]*<\/source_catalog>/,
    );
  });
});
