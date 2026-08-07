export const checklistSchema = {
  type: 'object',
  description:
    'Checklist pin. Default mode is flat (simple item list). Use mode sections for grouped checklists with section headings.',
  properties: {
    mode: {
      type: 'string',
      enum: ['flat', 'sections'],
      description: 'flat = default simple checklist; sections = grouped by section headings',
    },
    title: {
      type: 'string',
      description: 'Optional title for the checklist',
    },
    footer: {
      type: 'string',
      description: 'Optional footer note (sections mode only, e.g. execution order)',
    },
    items: {
      type: 'array',
      description: 'Flat checklist items (mode flat)',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier for the checklist item',
          },
          name: {
            type: 'string',
            description: 'Name/title of the checklist item',
          },
          description: {
            type: 'string',
            description: 'Optional description for the checklist item',
          },
          checked: {
            type: 'boolean',
            description: 'Whether the item is checked (defaults to false)',
          },
        },
        required: ['id', 'name'],
      },
    },
    sections: {
      type: 'array',
      description: 'Sectioned checklist (mode sections only)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Section id' },
          title: { type: 'string', description: 'Section heading (e.g. SECTION A)' },
          label: {
            type: 'string',
            description: 'Left column micro-label (e.g. CMS, toteach-agents)',
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                checked: { type: 'boolean' },
              },
              required: ['id', 'name'],
            },
            minItems: 1,
          },
        },
        required: ['id', 'title', 'items'],
      },
    },
  },
};
