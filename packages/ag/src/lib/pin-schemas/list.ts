export const listSchema = {
  type: 'object',
  description:
    'Structured text list pin. Default style plain (no bullets or numbers). Use bullet or numbered when presentation needs markers. For task completion use checklist; for URLs use links; for metrics use key-value — not markdown blobs.',
  properties: {
    style: {
      type: 'string',
      enum: ['plain', 'bullet', 'numbered'],
      description: 'plain = default stacked lines; bullet = • prefix; numbered = 1. 2. 3.',
    },
    mode: {
      type: 'string',
      enum: ['flat', 'sections'],
      description: 'flat = single items[] list; sections = grouped headings with items[] per section',
    },
    title: {
      type: 'string',
      description: 'Optional list title (e.g. Key findings, Deliverables)',
    },
    items: {
      type: 'array',
      description: 'Flat list rows (mode flat)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique id e.g. list-1' },
          text: { type: 'string', description: 'Primary line' },
          subtext: { type: 'string', description: 'Optional secondary line' },
          badge: { type: 'string', description: 'Optional short label e.g. New, Blocked' },
        },
        required: ['id', 'text'],
      },
    },
    sections: {
      type: 'array',
      description: 'Grouped list (mode sections only)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string', description: 'Section heading' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                subtext: { type: 'string' },
                badge: { type: 'string' },
              },
              required: ['id', 'text'],
            },
            minItems: 1,
          },
        },
        required: ['id', 'title', 'items'],
      },
    },
  },
};
