export const statCardsSchema = {
  type: 'object',
  description: 'Display key metrics and KPIs with trend indicators',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier for the card'
          },
          title: {
            type: 'string',
            description: 'Metric name or title'
          },
          value: {
            type: ['string', 'number'],
            description: 'Current metric value'
          },
          change: {
            type: 'string',
            description: 'Change indicator (e.g., "+12.5%")'
          },
          trend: {
            type: 'string',
            enum: ['up', 'down', 'neutral'],
            description: 'Trend direction'
          },
          previousValue: {
            type: 'string',
            description: 'Optional comparison baseline (e.g. "1,140") shown as "vs previous"'
          }
        },
        required: ['title', 'value']
      },
      description: 'Array of stat cards to display'
    }
  },
  required: ['cards']
};






















