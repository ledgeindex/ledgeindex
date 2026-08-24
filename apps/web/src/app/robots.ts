import type { MetadataRoute } from "next";
import { AI_AGENT_USER_AGENTS } from "@/lib/agent-readiness/constants";
import { ROBOTS_DISALLOW_PATHS } from "@/lib/seo-non-indexable-paths";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  const disallow = [...ROBOTS_DISALLOW_PATHS];

  const aiBotRules: MetadataRoute.Robots["rules"] = AI_AGENT_USER_AGENTS.map(
    (userAgent) => ({
      userAgent,
      allow: "/",
      disallow,
    }),
  );

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow,
      },
      ...aiBotRules,
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
