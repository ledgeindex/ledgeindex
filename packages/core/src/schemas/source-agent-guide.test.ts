import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSourceAgentGuideForAnswer,
  formatSourceAgentGuideForRewrite,
  MAX_SOURCE_AGENT_GUIDE_TOPICS,
  sourceAgentGuideSchema,
  sourceAgentGuideFromMetadata,
} from "./source-agent-guide.js";

describe("source agent guide", () => {
  it("falls back to legacy capabilities stored in profile metadata", () => {
    const guide = sourceAgentGuideFromMetadata({
      sourceType: "documentation",
      sourceTypeConfidence: 1,
      origin: "external",
      detectedSignals: [],
      siteProfile: {
        rootUrl: "https://example.com/docs",
        lenses: ["docs_identity", "capabilities"],
        profile: {
          docs_identity: { overallSummary: "Example framework docs." },
          capabilities: {
            capabilities: [
              {
                name: "Agents",
                description: "Build agents.",
                priority: "main",
              },
              {
                name: "Internals",
                description: "Internal details.",
                priority: "supporting",
              },
            ],
          },
        },
      },
    });

    assert.equal(guide?.summary, "Example framework docs.");
    assert.deepEqual(guide?.topics.map((topic) => topic.name), ["Agents"]);
    assert.match(formatSourceAgentGuideForRewrite(guide), /Main topics: Agents/);
    assert.match(
      formatSourceAgentGuideForAnswer(guide),
      /Support factual answers exclusively with retrieved context/,
    );
  });

  it("prefers dedicated documentation topics over product capabilities", () => {
    const guide = sourceAgentGuideFromMetadata({
      sourceType: "documentation",
      sourceTypeConfidence: 1,
      origin: "external",
      detectedSignals: [],
      siteProfile: {
        rootUrl: "https://example.com/docs",
        lenses: ["docs_identity", "docs_topics"],
        profile: {
          docs_identity: { overallSummary: "Example framework docs." },
          docs_topics: {
            topics: [
              {
                name: "Workflows",
                description: "Build multi-step workflows.",
                priority: "main",
              },
            ],
          },
          capabilities: {
            capabilities: [
              {
                name: "Narrow product feature",
                description: "Legacy capability.",
                priority: "main",
              },
            ],
          },
        },
      },
    });

    assert.deepEqual(guide?.topics.map((topic) => topic.name), ["Workflows"]);
  });

  it("accepts up to 25 editable topics", () => {
    const topics = Array.from(
      { length: MAX_SOURCE_AGENT_GUIDE_TOPICS },
      (_, index) => ({
        name: `Topic ${index + 1}`,
        description: `Description ${index + 1}`,
        priority: "top" as const,
      }),
    );

    assert.equal(
      sourceAgentGuideSchema.safeParse({ summary: "Documentation", topics })
        .success,
      true,
    );
    assert.equal(
      sourceAgentGuideSchema.safeParse({
        summary: "Documentation",
        topics: [
          ...topics,
          { name: "Extra", description: "Extra topic", priority: "top" },
        ],
      }).success,
      false,
    );
  });
});
