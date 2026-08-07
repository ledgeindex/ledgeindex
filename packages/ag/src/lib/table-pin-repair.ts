type TableColumn = { id?: string; name?: string }
type TableRow = { id?: string; cells?: Record<string, unknown> } & Record<string, unknown>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readUpstreamRecord(upstream: unknown): Record<string, unknown> {
  return isPlainObject(upstream) ? upstream : {}
}

function columnId(col: TableColumn, index: number): string {
  return String(col.id ?? col.name ?? `col-${index}`)
}

export function tablePinHasCellContent(pinConfig: Record<string, unknown>): boolean {
  const rows = Array.isArray(pinConfig.rows) ? (pinConfig.rows as TableRow[]) : []
  return rows.some((row) => {
    const cells = isPlainObject(row.cells) ? row.cells : row
    return Object.values(cells).some((value) => value != null && String(value).trim() !== '')
  })
}

function buildRowsFromGoals(
  goals: unknown[],
  columns: TableColumn[]
): TableRow[] {
  const goalCol = columnId(columns[0] ?? { id: 'goal' }, 0)
  const docCol = columnId(
    columns.find((c) => {
      const id = String(c.id ?? '').toLowerCase()
      const name = String(c.name ?? '').toLowerCase()
      return id === 'doc' || id === 'resource' || name.includes('doc') || name.includes('resource')
    }) ?? columns[1] ?? { id: 'doc' },
    1
  )

  return goals.map((entry, index) => {
    const item = isPlainObject(entry) ? entry : {}
    return {
      id: `row-${index + 1}`,
      cells: {
        [goalCol]: String(item.goal ?? item.title ?? item.text ?? ''),
        [docCol]: String(item.doc ?? item.resource ?? item.href ?? item.link ?? '')
      }
    }
  })
}

function buildRowsFromLinks(
  links: unknown[],
  columns: TableColumn[]
): TableRow[] {
  const textCol = columnId(columns[0] ?? { id: 'text' }, 0)
  const hrefCol = columnId(columns[1] ?? { id: 'href' }, 1)

  return links.map((entry, index) => {
    const item = isPlainObject(entry) ? entry : {}
    return {
      id: `row-${index + 1}`,
      cells: {
        [textCol]: String(item.text ?? item.title ?? item.name ?? item.href ?? ''),
        [hrefCol]: String(item.href ?? item.url ?? '')
      }
    }
  })
}

/** Fill table rows from upstream goals/links when the agent left cells empty. */
export function repairTablePinIfEmpty(
  pinConfig: Record<string, unknown>,
  upstream: unknown
): Record<string, unknown> {
  if (tablePinHasCellContent(pinConfig)) return pinConfig

  const record = readUpstreamRecord(upstream)
  const columns = Array.isArray(pinConfig.columns) ? (pinConfig.columns as TableColumn[]) : []
  const goals = Array.isArray(record.goals) ? record.goals : []
  const links = Array.isArray(record.links) ? record.links : []

  if (goals.length > 0) {
    const rows = buildRowsFromGoals(goals, columns)
    return {
      ...pinConfig,
      columns:
        columns.length >= 2
          ? columns
          : [
              { id: 'goal', name: 'Goal / Capability', type: 'text' },
              { id: 'doc', name: 'Documentation', type: 'text' }
            ],
      rows
    }
  }

  if (links.length > 0) {
    const rows = buildRowsFromLinks(links, columns)
    return {
      ...pinConfig,
      columns:
        columns.length >= 2
          ? columns
          : [
              { id: 'text', name: 'Text', type: 'text' },
              { id: 'href', name: 'URL', type: 'text' }
            ],
      rows
    }
  }

  return pinConfig
}
