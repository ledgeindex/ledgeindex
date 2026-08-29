# `@ledgeindex/sdk`

## Profile an indexed source without crawling it again

Use `profileIndexedSource` after a source has been indexed. It exports the
stored page markdown, converts it to profile `seedPages`, and runs only the
`docs_identity` and `capabilities` lenses.

```ts
import { createLedgeIndex } from "@ledgeindex/sdk";

const ledgeindex = await createLedgeIndex();
const result = await ledgeindex.profileIndexedSource("mastra");

console.log(result.profile.docs_identity);
console.log(result.profile.capabilities);
```

The method uses at most 200 indexed pages and 120,000 markdown characters per
page. Lower deterministic limits can be supplied:

```ts
const result = await ledgeindex.profileIndexedSource("mastra", {
  maxSeedPages: 80,
  maxMarkdownChars: 60_000,
  hint: "Prioritize agents, workflows, observability, and deployment.",
  modelId: "openai/gpt-5.6-sol",
});
```

The standalone `profileIndexedSource(sourceIdOrSlug, options?, initOptions?)`
export provides the same behavior. For custom lenses or externally supplied
pages, use the lower-level API:

```ts
const result = await ledgeindex.profile("https://example.com/docs", {
  lenses: ["docs_identity"],
  seedPages: [
    {
      url: "https://example.com/docs/start",
      title: "Get started",
      markdown: "# Get started\n...",
    },
  ],
});
```

Supplying `seedPages` skips discovery and page fetching; the profiler picks and
synthesizes from the supplied content.
