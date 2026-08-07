export const tableSchema = {
  type: 'object',
  description: 'Flexible Airtable-like data table with custom columns and rows',
  properties: {
    columns: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Column identifier'
          },
          name: {
            type: 'string',
            description: 'Column display name'
          },
          type: {
            type: 'string',
            description: 'Column data type (text, number, etc.)'
          },
          width: {
            type: 'number',
            description: 'Column width in pixels'
          }
        },
        required: ['id', 'name']
      },
      description: 'Table column definitions'
    },
    rows: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Row identifier'
          },
          cells: {
            type: 'object',
            description: 'Object mapping column IDs to populated string, number, or boolean cell values',
            additionalProperties: {
              type: ['string', 'number', 'boolean']
            }
          }
        },
        required: ['id', 'cells']
      },
      description: 'Table row data'
    },
    title: {
      type: 'string',
      description: 'Table title'
    }
  },
  required: ['columns', 'rows']
};






















