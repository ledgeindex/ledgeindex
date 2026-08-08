export const keyValueSchema = {
  type: 'object',
  description:
    'Compact key-value metrics pin. REQUIRED: items[] with {id,key,value}. Do NOT use content or content.data (markdown shape). For grid layouts set layout:"grid" and columns:2|3|4.',
  properties: {
    title: {
      type: 'string',
      description: 'Optional title shown above metrics',
    },
    period: {
      type: 'string',
      description: 'Optional period label (e.g. date range, run id, billing cycle)',
    },
    subtitle: {
      type: 'string',
      description: 'Alias for period when period is omitted',
    },
    layout: {
      type: 'string',
      enum: ['list', 'grid'],
      description: 'list = one metric per row; grid = tiled cells (default list)',
    },
    columns: {
      type: 'number',
      enum: [2, 3, 4],
      description: 'Grid columns per row when layout is grid (default 3)',
    },
    items: {
      type: 'array',
      description: 'Metric rows — the only data array. Never nest under content.data.',
      minItems: 1,
      maxItems: 48,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique id e.g. kv-1' },
          key: { type: 'string', description: 'Metric label (shown uppercase micro-label)' },
          value: {
            oneOf: [{ type: 'string' }, { type: 'number' }],
            description: 'Metric value',
          },
          unit: { type: 'string', description: 'Optional suffix (ms, %, credits)' },
          hint: { type: 'string', description: 'Optional secondary note' },
        },
        required: ['id', 'key', 'value'],
      },
    },
  },
  required: ['items'],
};
