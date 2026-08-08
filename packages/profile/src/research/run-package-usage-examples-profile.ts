import {
  pickCatalogForLens,
  pickCatalogForQuery,
  type CatalogPickResult,
  type SiteCatalogPage,
} from "./crawl-catalog.js";
import { fetchPickedPages, type FetchedPage } from "./fetch-picked-pages.js";
import { enrichPackageUsageExamplesWithFetchedPages } from "./enrich-package-usage-examples.js";
import type { ProfileModelSelection } from "./profile-model.js";
import { resolveProfileStepModel } from "./profile-model.js";
import type { PackageUsageExamplesInventory } from "./package-usage-examples-inventory.js";
import {
  PACKAGE_GUIDE_CODE_EXAMPLES_SYNTH_INSTRUCTIONS,
  PACKAGE_USAGE_EXAMPLES_INVENTORY_PICK_MESSAGE,
  PACKAGE_USAGE_EXAMPLES_INVENTORY_SYNTH_INSTRUCTIONS,
  buildGuideExamplesPickMessage,
  packageGuideCodeExamplesSchema,
  packageUsageExamplesInventorySchema,
} from "./package-usage-examples-inventory.js";
import {
  packageUsageExamplesLensSchema,
  type PackageUsageExamplesLensOutput,
} from "./research-lenses.js";
import type { CompanyProfileLensRun, CompanyProfileProgress } from "./run-company-profile.js";
import { synthesizeStructured } from "./synthesize-lens.js";

export type RunPackageUsageExamplesInput = {
  catalog: SiteCatalogPage[];
  rootUrl: string;
  modelId?: string;
  model?: ProfileModelSelection | null;
  pickOnly?: boolean;
  lensIndex: number;
  lensTotal: number;
  onProgress?: (progress: CompanyProfileProgress) => void;
};

export type RunPackageUsageExamplesResult = {
  data: PackageUsageExamplesLensOutput;
  lensRun: CompanyProfileLensRun;
  coverageWarnings: string[];
};

function mergePicks(
  inventoryPick: CatalogPickResult,
  examplePicks: CatalogPickResult[],
): CatalogPickResult {
  const selected = new Map<string, SiteCatalogPage>();
  for (const page of inventoryPick.selected) {
    selected.set(page.url, page);
  }
  for (const pick of examplePicks) {
    for (const page of pick.selected) {
      selected.set(page.url, page);
    }
  }
  return {
    ...inventoryPick,
    query: "package_usage_examples:two-step",
    summary: [inventoryPick.summary, ...examplePicks.map((p) => p.summary)]
      .filter(Boolean)
      .join(" "),
    selected: [...selected.values()],
  };
}

export async function runPackageUsageExamplesProfile(
  input: RunPackageUsageExamplesInput,
): Promise<RunPackageUsageExamplesResult> {
  const modelOpts = { modelId: input.modelId, model: input.model };
  const { modelId } = await resolveProfileStepModel(modelOpts);
  const coverageWarnings: string[] = [];
  const allSourceUrls = new Set<string>();
  const allFetched: FetchedPage[] = [];
  const examplePicks: CatalogPickResult[] = [];
  let fetchedPageCount = 0;

  const emit = (partial: Partial<CompanyProfileProgress>) => {
    input.onProgress?.({
      phase: "pick",
      lens: "package_usage_examples",
      index: input.lensIndex,
      total: input.lensTotal,
      ...partial,
    });
  };

  emit({ subphase: "inventory" });
  let inventoryPick = await pickCatalogForQuery(
    input.catalog,
    PACKAGE_USAGE_EXAMPLES_INVENTORY_PICK_MESSAGE,
    modelOpts,
  );

  if (inventoryPick.selected.length === 0) {
    inventoryPick = await pickCatalogForLens(
      input.catalog,
      "package_usage_examples",
      { ...modelOpts, rootUrl: input.rootUrl },
    );
  }

  if (inventoryPick.selected.length === 0) {
    return {
      data: { examples: [], notes: "No pages picked for guides inventory." },
      lensRun: {
        lens: "package_usage_examples",
        pick: inventoryPick,
        fetchedPageCount: 0,
      },
      coverageWarnings: ["No catalog pages selected for guides inventory."],
    };
  }

  if (input.pickOnly) {
    return {
      data: { examples: [] },
      lensRun: {
        lens: "package_usage_examples",
        pick: inventoryPick,
        fetchedPageCount: 0,
      },
      coverageWarnings: [],
    };
  }

  input.onProgress?.({
    phase: "fetch",
    lens: "package_usage_examples",
    index: input.lensIndex,
    total: input.lensTotal,
    subphase: "inventory",
  });

  const inventoryFetched = await fetchPickedPages(inventoryPick.selected, {
    modelId,
  });
  fetchedPageCount += inventoryFetched.pages.length;
  allFetched.push(...inventoryFetched.pages);
  for (const p of inventoryFetched.pages) {
    if (p.url) allSourceUrls.add(p.url);
  }

  input.onProgress?.({
    phase: "synthesize",
    lens: "package_usage_examples",
    index: input.lensIndex,
    total: input.lensTotal,
    subphase: "inventory",
  });

  const inventorySynth = await synthesizeStructured<PackageUsageExamplesInventory>({
    id: "package-usage-examples-inventory",
    label: "Package guides — inventory",
    instructions: PACKAGE_USAGE_EXAMPLES_INVENTORY_SYNTH_INSTRUCTIONS,
    schema: packageUsageExamplesInventorySchema,
    fetched: inventoryFetched.pages,
    userPromptPrefix:
      "List concrete guides, tutorials, and example scenarios from these docs pages.",
    ...modelOpts,
  });

  const priorityOrder = { main: 0, top: 1, supporting: 2 } as const;
  const forExamples = [...inventorySynth.data.examples].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
  const enrichedByName = new Map<
    string,
    PackageUsageExamplesLensOutput["examples"][number]
  >();

  for (let ei = 0; ei < forExamples.length; ei++) {
    const guide = forExamples[ei]!;
    emit({ subphase: "examples", primitiveName: guide.name });

    const pickMessage = buildGuideExamplesPickMessage({
      name: guide.name,
      kind: guide.kind,
    });

    let pick = await pickCatalogForQuery(input.catalog, pickMessage, modelOpts);
    if (pick.selected.length === 0) {
      pick = await pickCatalogForQuery(
        input.catalog,
        `tutorial code example ${guide.name}`,
        modelOpts,
      );
    }
    examplePicks.push(pick);

    if (pick.selected.length === 0) {
      coverageWarnings.push(`No code pages picked for guide "${guide.name}".`);
      enrichedByName.set(guide.name, { ...guide });
      continue;
    }

    input.onProgress?.({
      phase: "fetch",
      lens: "package_usage_examples",
      index: input.lensIndex,
      total: input.lensTotal,
      subphase: "examples",
      primitiveName: guide.name,
    });

    const fetched = await fetchPickedPages(pick.selected, { modelId });
    fetchedPageCount += fetched.pages.length;
    allFetched.push(...fetched.pages);
    for (const p of fetched.pages) {
      if (p.url) allSourceUrls.add(p.url);
    }

    input.onProgress?.({
      phase: "synthesize",
      lens: "package_usage_examples",
      index: input.lensIndex,
      total: input.lensTotal,
      subphase: "examples",
      primitiveName: guide.name,
    });

    try {
      const code = await synthesizeStructured({
        id: `package-guide-code-${ei}`,
        label: `Package guide code — ${guide.name}`,
        instructions: PACKAGE_GUIDE_CODE_EXAMPLES_SYNTH_INSTRUCTIONS,
        schema: packageGuideCodeExamplesSchema,
        fetched: fetched.pages,
        userPromptPrefix: `Guide: ${guide.name}${guide.kind ? ` (${guide.kind})` : ""}`,
        ...modelOpts,
      });

      enrichedByName.set(guide.name, {
        ...guide,
        usageExample: code.data.usageExample,
        usageExamples: code.data.usageExamples,
        citation: code.data.citation ?? guide.citation,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      coverageWarnings.push(`Code extraction failed for "${guide.name}": ${msg}`);
      enrichedByName.set(guide.name, { ...guide });
    }
  }

  const mergedRows: PackageUsageExamplesLensOutput["examples"] =
    inventorySynth.data.examples.map((row) => {
      const enriched = enrichedByName.get(row.name);
      if (enriched) return enriched;
      return { ...row };
    });

  mergedRows.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const notesParts: string[] = [];
  if (inventorySynth.data.notes?.trim()) {
    notesParts.push(inventorySynth.data.notes.trim());
  }
  for (const row of mergedRows) {
    if (!row.usageExample?.trim()) {
      coverageWarnings.push(`Guide "${row.name}" (${row.priority}) has no usageExample code.`);
    }
  }
  if (coverageWarnings.length > 0) {
    notesParts.push(`Coverage: ${coverageWarnings.join(" ")}`);
  }

  let data: PackageUsageExamplesLensOutput = {
    examples: mergedRows,
    ...(notesParts.length > 0 ? { notes: notesParts.join("\n\n") } : {}),
  };

  data = enrichPackageUsageExamplesWithFetchedPages(data, allFetched);

  const parsed = packageUsageExamplesLensSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `package_usage_examples output invalid: ${parsed.error.message}`,
    );
  }

  return {
    data: parsed.data,
    coverageWarnings,
    lensRun: {
      lens: "package_usage_examples",
      pick: mergePicks(inventoryPick, examplePicks),
      fetchedPageCount,
      fetchedPages: allFetched,
      sourceUrls: [...allSourceUrls],
      synth: {
        lens: "package_usage_examples",
        modelId,
        sourceUrls: [...allSourceUrls],
        data: parsed.data,
      },
    },
  };
}
