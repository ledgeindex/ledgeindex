/**
 * JSON Schema pin_config definitions for AutomationGhost v1 pin types.
 * Copied from agents-content/src/mastra/schemas — keep in sync when pin shapes change.
 */
import { markdownSchema } from './markdown'
import { tableSchema } from './table'
import { planSchema } from './plan'
import { listSchema } from './list'
import { jsonListSchema } from './json-list'
import { checklistSchema } from './checklist'
import { statCardsSchema } from './stat-cards'
import { keyValueSchema } from './key-value'
import { chartsSchema } from './charts'
import { mermaidSchema } from './mermaid'
import { jsonViewerSchema } from './json-viewer'
import { linksSchema } from './links'
import { AUTOMATIONGHOST_PIN_TYPES_V1 } from '../automationghost-pin-types'

export const PIN_SCHEMAS: Record<string, Record<string, unknown>> = {
  markdown: markdownSchema,
  table: tableSchema,
  plan: planSchema,
  list: listSchema,
  'json-list': jsonListSchema,
  checklist: checklistSchema,
  'stat-cards': statCardsSchema,
  'key-value': keyValueSchema,
  charts: chartsSchema,
  mermaid: mermaidSchema,
  'json-viewer': jsonViewerSchema,
  links: linksSchema
}

/** Pin types with a local PIN_SCHEMAS entry — must match AUTOMATIONGHOST_PIN_TYPES_V1. */
export const PIN_SCHEMA_PIN_TYPES = AUTOMATIONGHOST_PIN_TYPES_V1.filter(
  (pinType) => pinType in PIN_SCHEMAS
)
