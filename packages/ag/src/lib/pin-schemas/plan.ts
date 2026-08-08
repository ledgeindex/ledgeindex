/**
 * Plan Pin Schema
 *
 * Phased implementation plan with tasks and reusable content blocks
 * (details lists, terminal commands, code snippets).
 */
export const planSchema = {
  type: 'object',
  description:
    'Structured implementation plan with phases, tasks, and content blocks (details, command, code, text, summary, link, mermaid). Use for agent-generated build plans, sprint breakdowns, and technical roadmaps — not for live execution traces (use trace) or simple step lists (use steps).',
  properties: {
    title: {
      type: 'string',
      description: 'Plan title (e.g. "Auth Requirements Board")',
    },
    status: {
      type: 'string',
      enum: ['draft', 'in-progress', 'completed'],
      description: 'Overall plan status',
    },
    breadcrumbs: {
      type: 'array',
      description: 'Optional header chips (e.g. Building, In Progress)',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
        },
        required: ['label'],
      },
    },
    phases: {
      type: 'array',
      description: 'Ordered plan phases, each containing tasks',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string', description: 'Phase title (e.g. "Phase 2: Implementation")' },
          status: {
            type: 'string',
            enum: ['pending', 'in-progress', 'completed'],
          },
          tasks: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                number: { type: 'string', description: 'Task number label (e.g. "2.1")' },
                title: { type: 'string' },
                label: { type: 'string', description: 'Category label (e.g. Frontend, Backend)' },
                description: {
                  type: 'string',
                  description: 'Task summary — markdown supported (headings, bullets, `code`)',
                },
                blocks: {
                  type: 'array',
                  description:
                    'Reusable content blocks: details (bullet list), command (shell one-liner), code (snippet), text (short note), summary (task overview/intro), link (URL), mermaid (diagram)',
                  items: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['details', 'command', 'code', 'text', 'summary', 'link', 'mermaid'],
                      },
                      title: {
                        type: 'string',
                        description: 'Optional title for details, summary, or mermaid blocks',
                      },
                      diagram: {
                        type: 'string',
                        description: 'Mermaid diagram source for mermaid blocks (graph TD, sequenceDiagram, etc.)',
                      },
                      items: {
                        type: 'array',
                        description:
                          'Bullet lines for details blocks — markdown supported (`code`, **bold**, [links](url))',
                        items: { type: 'string' },
                      },
                      command: { type: 'string' },
                      label: { type: 'string', description: 'Optional label for command or link blocks' },
                      url: { type: 'string', description: 'HTTPS URL for link blocks' },
                      code: { type: 'string' },
                      title: {
                        type: 'string',
                        description: 'Optional display title for code blocks (e.g. Execution Flow)',
                      },
                      language: { type: 'string' },
                      filename: { type: 'string' },
                      content: {
                        type: 'string',
                        description:
                          'Markdown body for text or summary blocks — headings, bullets (- **Label:** text), `code`, links',
                      },
                    },
                    required: ['type'],
                  },
                },
              },
              required: ['title'],
            },
          },
        },
        required: ['title', 'tasks'],
      },
    },
  },
  required: ['phases'],
};
