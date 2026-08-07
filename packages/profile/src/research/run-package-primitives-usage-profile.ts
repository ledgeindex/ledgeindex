import {
  pickCatalogForLens,
  pickCatalogForQuery,
  type CatalogPickResult,
  type SiteCatalogPage,
} from "./crawl-catalog.js";
import { fetchPickedPages } from "./fetch-picked-pages.js";
import type { ProfileModelSelection } from "./profile-model.js";
import { resolveProfileStepModel } from "./profile-model.js";
import type { PackagePrimitivesInventory } from "./package-primitives-inventory.js";
import {
  buildPrimitiveExamplesPickMessage,
  PACKAGE_PRIMITIVES_INVENTORY_PICK_MESSAGE,
  PACKAGE_PRIMITIVES_INVENTORY_SYNTH_INSTRUCTIONS,
  PACKAGE_PRIMITIVE_EXAMPLES_SYNTH_INSTRUCTIONS,
  packagePrimitiveExamplesSchema,
  packagePrimitivesInventorySchema,
} from "./package-primitives-inventory.js";
import {
  packagePrimitivesUsageLensSchema,
  type PackagePrimitivesUsageLensOutput,
} from "./research-lenses.js";
import type { CompanyProfileLensRun, CompanyProfileProgress } from "./run-company-profile.js";
import { synthesizeStructured } from "./synthesize-lens.js";

export type RunPackagePrimitivesUsageInput = {
  catalog: SiteCatalogPage[];
  rootUrl: string;
  modelId?: string;
  model?: ProfileModelSelection | null;
  pickOnly?: boolean;
  lensIndex: number;
  lensTotal: number;
  onProgress?: (progress: CompanyProfileProgress) => void;
};

export type RunPackagePrimitivesUsageResult = {
  data: PackagePrimitivesUsageLensOutput;
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
    query: "package_primitives_usage:two-step",
    summary: [inventoryPick.summary, ...examplePicks.map((p) => p.summary)]
      .filter(Boolean)
      .join(" "),
    selected: [...selected.values()],
  };
}

export async function runPackagePrimitivesUsageProfile(
  input: RunPackagePrimitivesUsageInput,
): Promise<RunPackagePrimitivesUsageResult> {
  const modelOpts = { modelId: input.modelId, model: input.model };
  const { modelId } = await resolveProfileStepModel(modelOpts);
  const coverageWarnings: string[] = [];
  const allSourceUrls = new Set<string>();
  const examplePicks: CatalogPickResult[] = [];
  let fetchedPageCount = 0;

  const emit = (partial: Partial<CompanyProfileProgress>) => {
    input.onProgress?.({
      phase: "pick",
      lens: "package_primitives_usage",
      index: input.lensIndex,
      total: input.lensTotal,
      ...partial,
    });
  };

  emit({ subphase: "inventory" });
  const inventoryPick = await pickCatalogForQuery(
    input.catalog,
    PACKAGE_PRIMITIVES_INVENTORY_PICK_MESSAGE,
    modelOpts,
  );

  if (inventoryPick.selected.length === 0) {
    const fallbackPick = await pickCatalogForLens(
      input.catalog,
      "package_primitives_usage",
      { ...modelOpts, rootUrl: input.rootUrl },
    );
    Object.assign(inventoryPick, fallbackPick);
  }

  if (inventoryPick.selected.length === 0) {
    return {
      data: { primitives: [], notes: "No pages picked for primitive inventory." },
      lensRun: {
        lens: "package_primitives_usage",
        pick: inventoryPick,
        fetchedPageCount: 0,
      },
      coverageWarnings: ["No catalog pages selected for inventory."],
    };
  }

  if (input.pickOnly) {
    return {
      data: { primitives: [] },
      lensRun: {
        lens: "package_primitives_usage",
        pick: inventoryPick,
        fetchedPageCount: 0,
      },
      coverageWarnings: [],
    };
  }

  input.onProgress?.({
    phase: "fetch",
    lens: "package_primitives_usage",
    index: input.lensIndex,
    total: input.lensTotal,
    subphase: "inventory",
  });

  const inventoryFetched = await fetchPickedPages(inventoryPick.selected, {
    modelId,
  });
  fetchedPageCount += inventoryFetched.pages.length;
  for (const p of inventoryFetched.pages) {
    if (p.url) allSourceUrls.add(p.url);
  }

  input.onProgress?.({
    phase: "synthesize",
    lens: "package_primitives_usage",
    index: input.lensIndex,
    total: input.lensTotal,
    subphase: "inventory",
  });

  const inventorySynth = await synthesizeStructured<PackagePrimitivesInventory>({
    id: "package-primitives-inventory",
    label: "Package primitives — inventory",
    instructions: PACKAGE_PRIMITIVES_INVENTORY_SYNTH_INSTRUCTIONS,
    schema: packagePrimitivesInventorySchema,
    fetched: inventoryFetched.pages,
    userPromptPrefix: "List the package's core primitives (building blocks / APIs).",
    ...modelOpts,
  });

  const priorityOrder = { main: 0, top: 1, supporting: 2 } as const;
  const forExamples = [...inventorySynth.data.primitives].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
  const enrichedByName = new Map<
    string,
    PackagePrimitivesUsageLensOutput["primitives"][number]
  >();

  for (let pi = 0; pi < forExamples.length; pi++) {
    const inv = forExamples[pi]!;
    emit({ subphase: "examples", primitiveName: inv.name });

    const pickMessage = buildPrimitiveExamplesPickMessage({
      name: inv.name,
      primitiveOrApi: inv.primitiveOrApi,
    });

    let pick = await pickCatalogForQuery(input.catalog, pickMessage, modelOpts);
    if (pick.selected.length === 0) {
      pick = await pickCatalogForQuery(
        input.catalog,
        `code examples tutorial ${inv.name} ${inv.primitiveOrApi ?? ""}`,
        modelOpts,
      );
    }
    examplePicks.push(pick);

    if (pick.selected.length === 0) {
      coverageWarnings.push(`No example pages picked for primitive "${inv.name}".`);
      enrichedByName.set(inv.name, {
        name: inv.name,
        description: inv.description,
        priority: inv.priority,
        primitiveOrApi: inv.primitiveOrApi,
        citation: inv.citation,
      });
      continue;
    }

    input.onProgress?.({
      phase: "fetch",
      lens: "package_primitives_usage",
      index: input.lensIndex,
      total: input.lensTotal,
      subphase: "examples",
      primitiveName: inv.name,
    });

    const fetched = await fetchPickedPages(pick.selected, { modelId });
    fetchedPageCount += fetched.pages.length;
    for (const p of fetched.pages) {
      if (p.url) allSourceUrls.add(p.url);
    }

    input.onProgress?.({
      phase: "synthesize",
      lens: "package_primitives_usage",
      index: input.lensIndex,
      total: input.lensTotal,
      subphase: "examples",
      primitiveName: inv.name,
    });

    try {
      const examples = await synthesizeStructured({
        id: `package-primitive-examples-${pi}`,
        label: `Package primitive examples — ${inv.name}`,
        instructions: PACKAGE_PRIMITIVE_EXAMPLES_SYNTH_INSTRUCTIONS,
        schema: packagePrimitiveExamplesSchema,
        fetched: fetched.pages,
        userPromptPrefix: `Primitive: ${inv.name}${inv.primitiveOrApi ? ` (${inv.primitiveOrApi})` : ""}`,
        ...modelOpts,
      });

      enrichedByName.set(inv.name, {
        name: inv.name,
        description: inv.description,
        priority: inv.priority,
        primitiveOrApi: inv.primitiveOrApi,
        howToHint: examples.data.howToHint,
        usageExample: examples.data.usageExample,
        usageExamples: examples.data.usageExamples,
        suggestedTemplateTitle: examples.data.suggestedTemplateTitle,
        citation: examples.data.citation,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      coverageWarnings.push(`Example extraction failed for "${inv.name}": ${msg}`);
      enrichedByName.set(inv.name, {
        name: inv.name,
        description: inv.description,
        priority: inv.priority,
        primitiveOrApi: inv.primitiveOrApi,
        citation: inv.citation,
      });
    }
  }

  const mergedRows: PackagePrimitivesUsageLensOutput["primitives"] =
    inventorySynth.data.primitives.map((inv) => {
      const enriched = enrichedByName.get(inv.name);
      if (enriched) return enriched;
      return {
        name: inv.name,
        description: inv.description,
        priority: inv.priority,
        primitiveOrApi: inv.primitiveOrApi,
        citation: inv.citation,
      };
    });

  mergedRows.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  const notesParts: string[] = [];
  if (inventorySynth.data.notes?.trim()) {
    notesParts.push(inventorySynth.data.notes.trim());
  }
  for (const row of mergedRows) {
    if (!row.usageExample?.trim()) {
      coverageWarnings.push(`Primitive "${row.name}" has no usageExample.`);
    }
  }
  if (coverageWarnings.length > 0) {
    notesParts.push(`Coverage: ${coverageWarnings.join(" ")}`);
  }

  const data: PackagePrimitivesUsageLensOutput = {
    primitives: mergedRows,
    ...(notesParts.length > 0 ? { notes: notesParts.join("\n\n") } : {}),
  };

  const parsed = packagePrimitivesUsageLensSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `package_primitives_usage output invalid: ${parsed.error.message}`,
    );
  }

  return {
    data: parsed.data,
    coverageWarnings,
    lensRun: {
      lens: "package_primitives_usage",
      pick: mergePicks(inventoryPick, examplePicks),
      fetchedPageCount,
      sourceUrls: [...allSourceUrls],
      synth: {
        lens: "package_primitives_usage",
        modelId,
        sourceUrls: [...allSourceUrls],
        data: parsed.data,
      },
    },
  };
}
