import { z } from "zod";

export const MAX_SOURCE_AGENT_GUIDE_TOPICS = 25;

export const sourceAgentGuideTopicSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  priority: z.enum(["main", "top"]),
});

export const sourceAgentGuideSchema = z.object({
  summary: z.string().min(1).max(1000),
  topics: z.array(sourceAgentGuideTopicSchema).max(MAX_SOURCE_AGENT_GUIDE_TOPICS),
});

export type SourceAgentGuide = z.infer<typeof sourceAgentGuideSchema>;
export type SourceAgentGuideTopic = z.infer<
  typeof sourceAgentGuideTopicSchema
>;

type SourceAgentGuideMetadata = {
  docsIdentity?: { overallSummary?: string };
  siteProfile?: { profile?: Record<string, unknown> };
};

export function sourceAgentGuideFromMetadata(
  metadata: SourceAgentGuideMetadata | null | undefined,
): SourceAgentGuide | null {
  const profile = metadata?.siteProfile?.profile;
  const identity =
    profile?.docs_identity && typeof profile.docs_identity === "object"
      ? profile.docs_identity
      : null;
  const docsTopics =
    profile?.docs_topics && typeof profile.docs_topics === "object"
      ? profile.docs_topics
      : null;
  const capabilities =
    profile?.capabilities && typeof profile.capabilities === "object"
      ? profile.capabilities
      : null;
  const summary =
    identity && "overallSummary" in identity
      ? String(identity.overallSummary ?? "").trim()
      : metadata?.docsIdentity?.overallSummary?.trim() ?? "";
  const rawTopics =
    docsTopics && "topics" in docsTopics
      ? docsTopics.topics
      : capabilities && "capabilities" in capabilities
      ? capabilities.capabilities
      : [];
  const topics = Array.isArray(rawTopics)
    ? rawTopics
        .filter(
          (topic): topic is Record<string, unknown> =>
            Boolean(topic) && typeof topic === "object",
        )
        .filter(
          (topic) => topic.priority === "main" || topic.priority === "top",
        )
        .map((topic) => ({
          name: String(topic.name ?? "").trim(),
          description: String(topic.description ?? "").trim(),
          priority:
            topic.priority === "main" ? ("main" as const) : ("top" as const),
        }))
        .filter((topic) => topic.name && topic.description)
        .slice(0, MAX_SOURCE_AGENT_GUIDE_TOPICS)
    : [];

  const parsed = sourceAgentGuideSchema.safeParse({ summary, topics });
  return parsed.success ? parsed.data : null;
}

export function formatSourceAgentGuideForRewrite(
  guide: SourceAgentGuide | null,
): string {
  if (!guide) return "";
  const topicNames = guide.topics.map((topic) => topic.name).join(", ");
  return [guide.summary, topicNames ? `Main topics: ${topicNames}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function formatSourceAgentGuideForAnswer(
  guide: SourceAgentGuide | null,
): string {
  if (!guide) return "";
  const topics = guide.topics.map(
    (topic) => `- ${topic.name}: ${topic.description}`,
  );
  return [
    "Source guide:",
    guide.summary,
    ...(topics.length > 0 ? ["Main topics:", ...topics] : []),
    "Use this guide only to understand the source scope. Support factual answers exclusively with retrieved context.",
  ].join("\n");
}
