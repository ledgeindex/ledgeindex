export type KeyValueLayout = 'list' | 'grid';
export type KeyValueColumns = 2 | 3 | 4;

export type KeyValueItem = {
  id: string;
  key: string;
  value: string | number;
  unit?: string;
  hint?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractKeyValueRawRows(config: Record<string, unknown>): unknown[] {
  if (Array.isArray(config.items) && config.items.length > 0) return config.items;
  const content = config.content;
  if (isPlainObject(content) && Array.isArray(content.data)) return content.data;
  if (Array.isArray(content)) return content;
  if (Array.isArray(config.data)) return config.data;
  if (Array.isArray(config.fields)) return config.fields;
  return [];
}

function inferKeyValueGridHints(config: Record<string, unknown>): {
  layout?: KeyValueLayout;
  columns?: KeyValueColumns;
} {
  if (config.layout === 'list') return { layout: 'list' };
  if (config.layout === 'grid') {
    const hinted = Number(config.columns);
    const columns: KeyValueColumns = hinted === 2 || hinted === 4 ? hinted : 3;
    return { layout: 'grid', columns };
  }
  return {};
}

/** Coerce agent/user shapes (e.g. content.data) into canonical key-value pin_config. */
export function normalizeKeyValuePinConfig(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const input = isPlainObject(raw) ? { ...raw } : {};
  const out: Record<string, unknown> = { ...input };

  const rows = extractKeyValueRawRows(input);
  out.items = rows
    .map((row, idx) => {
      if (!isPlainObject(row)) return null;
      const key = String(row.key ?? row.label ?? row.name ?? '').trim();
      const rawValue = row.value ?? row.val;
      if (!key && (rawValue == null || rawValue === '')) return null;
      const value =
        typeof rawValue === 'number'
          ? rawValue
          : String(rawValue ?? '').trim();
      const item: KeyValueItem = {
        id: String(row.id ?? '').trim() || `kv-${idx + 1}`,
        key: key || `Metric ${idx + 1}`,
        value,
      };
      const unit = String(row.unit ?? '').trim();
      if (unit) item.unit = unit;
      const hint = String(row.hint ?? '').trim();
      if (hint) item.hint = hint;
      return item;
    })
    .filter(Boolean);

  delete out.content;
  delete out.data;

  const inferred = inferKeyValueGridHints({ ...input, ...out });
  if (inferred.layout) out.layout = inferred.layout;
  if (inferred.columns) out.columns = inferred.columns;

  const title = String(out.title ?? '').trim();
  if (title) out.title = title;
  else delete out.title;

  const period = String(out.period ?? out.subtitle ?? '').trim();
  if (period) {
    out.period = period;
    out.subtitle = period;
  }

  return out;
}
