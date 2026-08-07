export const jsonViewerSchema = {
  type: 'object',
  description: 'Interactive JSON data viewer with syntax highlighting',
  properties: {
    json: {
      type: 'object',
      description: 'JSON object to display'
    },
    jsonString: {
      type: 'string',
      description: 'JSON as string (alternative to json object)'
    },
    title: {
      type: 'string',
      description: 'Viewer title'
    }
  },
  required: ['json']
};






















