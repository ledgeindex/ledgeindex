/**
 * JSON Schema for links pin_config — mirrors Pindown agents-content/schemas/links.ts
 * and frontend LinksConfig ({ title?, links: [{ url, title, description?, icon? }] }).
 */
export const linksSchema = {
  type: 'object',
  description:
    'Curated URL list pin. Use for bookmarks, references, or job/apply links — not markdown blobs of URLs.',
  properties: {
    title: {
      type: 'string',
      description: 'Optional section title above the links list',
    },
    links: {
      type: 'array',
      description: 'Array of links',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Link URL' },
          title: { type: 'string', description: 'Link title' },
          description: { type: 'string', description: 'Optional short description' },
          icon: { type: 'string', description: 'Optional icon name or URL' },
        },
        required: ['url', 'title'],
      },
      minItems: 1,
    },
  },
  required: ['links'],
}
