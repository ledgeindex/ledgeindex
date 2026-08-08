import { fetchDocsPage } from '../docs-fetcher'
import { googleWebSearchTool } from '../../mastra/tools/google-web-search-tool'
import { buildDocsResearchFromPage } from './build-docs-research'
import { pickBestDocsUrl } from './pick-docs-url'
import type {
  PlanningContextBundle,
  PlanningNeedsAssessment,
  PlanningProgressEvent,
} from './types'

export type PlanningProgressHandler = (event: PlanningProgressEvent) => void | Promise<void>

export async function runPlanningEnrichments(
  prompt: string,
  needs: PlanningNeedsAssessment,
  onProgress?: PlanningProgressHandler,
): Promise<PlanningContextBundle> {
  const emit = async (phase: PlanningProgressEvent['phase'], message: string): Promise<void> => {
    await onProgress?.({ type: 'planning-progress', phase, message })
  }

  const bundle: PlanningContextBundle = {
    gates: needs.gates,
    integrations: {
      status: 'not_implemented',
      reason:
        needs.gates.integrations === 'pick'
          ? (needs.reasons?.integrations ?? 'Integration picking will run here.')
          : (needs.reasons?.integrations ?? 'No integration picking needed.'),
    },
  }

  const docsGate = needs.gates.docs

  if (docsGate === 'skip') {
    await emit('docs_skip', needs.reasons?.docs ?? 'No web docs research needed.')
    bundle.docs = {
      status: 'skipped',
      reason: needs.reasons?.docs ?? 'No web docs research needed.',
    }
    return bundle
  }

  if (docsGate === 'fetch_only' && needs.docsUrl) {
    await emit('docs_fetch', `Fetching documentation page…`)
    try {
      const page = await fetchDocsPage(needs.docsUrl)
      await emit('docs_summarize', 'Summarizing documentation findings…')
      bundle.docs = await buildDocsResearchFromPage({
        userPrompt: prompt,
        page,
        status: 'fetch_only',
        reason: 'User provided a documentation URL.',
      })
    } catch (error) {
      bundle.docs = {
        status: 'failed',
        reason: 'Failed to fetch the provided URL.',
        chosenUrl: needs.docsUrl,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return bundle
  }

  if (docsGate === 'search_and_fetch') {
    const query = needs.docsQuery ?? `${prompt} documentation`
    await emit('docs_search', `Searching the web for documentation…`)

    const search = await googleWebSearchTool.execute({ query })
    if (!search.ok || search.sources.length === 0) {
      bundle.docs = {
        status: 'failed',
        reason: 'Web search returned no sources.',
        query,
        error: search.errors?.join('; ') ?? 'search failed',
      }
      return bundle
    }

    await emit('docs_pick', `Choosing the best documentation page…`)
    const chosenUrl = pickBestDocsUrl(search.sources)
    if (!chosenUrl) {
      bundle.docs = {
        status: 'failed',
        reason: 'Could not pick a documentation URL from search results.',
        query,
      }
      return bundle
    }

    await emit('docs_fetch', `Fetching ${chosenUrl}…`)
    try {
      const page = await fetchDocsPage(chosenUrl)
      await emit('docs_summarize', 'Summarizing documentation findings…')
      bundle.docs = await buildDocsResearchFromPage({
        userPrompt: prompt,
        page,
        status: 'search_and_fetch',
        reason: needs.reasons?.docs ?? 'Prompt needs external documentation context.',
        query,
      })
    } catch (error) {
      bundle.docs = {
        status: 'failed',
        reason: 'Search succeeded but fetching the docs page failed.',
        query,
        chosenUrl,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return bundle
  }

  bundle.docs = {
    status: 'skipped',
    reason: `Unhandled docs gate: ${docsGate}`,
  }
  return bundle
}
