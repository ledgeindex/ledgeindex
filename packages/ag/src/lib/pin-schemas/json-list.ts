export const jsonListSchema = {
  type: 'object',
  description: 'List of JSON objects with expandable viewer for each item',
  properties: {
    json: {
      type: 'array',
      items: {
        type: 'object'
      },
      description: 'Array of JSON objects to display'
    },
    jsonString: {
      type: 'string',
      description: 'JSON array as string (alternative to json array)'
    },
    title: {
      type: 'string',
      description: 'List title'
    }
  },
  required: ['json']
};






















