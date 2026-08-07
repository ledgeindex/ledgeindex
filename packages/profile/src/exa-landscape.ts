import { createHash, randomUUID } from "node:crypto";
import Exa from "exa-js";
import { z } from "zod";

export const CompetitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  description: z.string(),
  employeeCount: z.number().nullable(),
  fundingStage: z.string().optional(),
  features: z.array(z.string()),
});

export type Competitor = z.infer<typeof CompetitorSchema>;

export const LandscapeRunSchema = z.object({
  id: z.string(),
  query: z.string(),
  status: z.enum(["completed", "failed"]),
  createdAt: z.string(),
  competitors: z.array(CompetitorSchema),
  error: z.string().optional(),
});

export type LandscapeRun = z.infer<typeof LandscapeRunSchema>;

const runs = new Map<string, LandscapeRun>();

function stableId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function mapResultToCompetitor(result: {
  title: string | null;
  url: string;
  summary?: string;
  highlights?: string[];
  entities?: Array<{ type: string; properties?: unknown }>;
}): Competitor {
  const entity = result.entities?.find((e) => e.type === "company");
  const props = entity?.properties as {
    name?: string | null;
    description?: string | null;
    workforce?: { total?: number | null } | null;
    financials?: {
      fundingLatestRound?: { name?: string | null } | null;
      fundingTotal?: number | null;
    } | null;
  } | null;

  const name =
    props?.name?.trim() || result.title?.trim() || new URL(result.url).hostname;
  const description =
    props?.description?.trim() ||
    result.summary?.trim() ||
    (result.highlights?.length ? result.highlights.join(" ") : "") ||
    "(no description)";
  const employeeCount =
    typeof props?.workforce?.total === "number" ? props.workforce.total : null;
  const fundingStage =
    props?.financials?.fundingLatestRound?.name?.trim() ||
    (props?.financials?.fundingTotal != null ? "funded" : undefined);
  const features = (result.highlights ?? [])
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 5);

  return CompetitorSchema.parse({
    id: stableId(result.url),
    name,
    url: result.url,
    description,
    employeeCount,
    fundingStage,
    features,
  });
}

export async function searchCompaniesWithExa(
  query: string,
  options?: { deep?: boolean; numResults?: number; userLocation?: string },
): Promise<Competitor[]> {
  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing EXA_API_KEY");
  }

  const exa = new Exa(apiKey);
  const numResults = options?.numResults ?? 15;
  const base = {
    category: "company" as const,
    numResults,
    ...(options?.userLocation ? { userLocation: options.userLocation } : {}),
    contents: {
      summary: true,
      highlights: { numSentences: 2, highlightsPerUrl: 2 },
    },
  };

  const searchOptions = options?.deep
    ? { type: "deep" as const, ...base }
    : { type: "auto" as const, ...base };

  const response = await exa.search(query, searchOptions);
  return response.results.map((r) =>
    mapResultToCompetitor({
      title: r.title,
      url: r.url,
      summary: "summary" in r ? (r.summary as string | undefined) : undefined,
      highlights: "highlights" in r ? (r.highlights as string[] | undefined) : undefined,
      entities: r.entities,
    }),
  );
}

export async function runCompanyLandscape(input: {
  query: string;
  deep?: boolean;
  userLocation?: string;
}): Promise<LandscapeRun> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  try {
    const competitors = await searchCompaniesWithExa(input.query, {
      deep: input.deep,
      userLocation: input.userLocation,
    });
    const run: LandscapeRun = {
      id,
      query: input.query,
      status: "completed",
      createdAt,
      competitors,
    };
    runs.set(id, run);
    return run;
  } catch (error) {
    const run: LandscapeRun = {
      id,
      query: input.query,
      status: "failed",
      createdAt,
      competitors: [],
      error: error instanceof Error ? error.message : String(error),
    };
    runs.set(id, run);
    return run;
  }
}

export function getLandscapeRun(id: string): LandscapeRun | null {
  return runs.get(id) ?? null;
}
