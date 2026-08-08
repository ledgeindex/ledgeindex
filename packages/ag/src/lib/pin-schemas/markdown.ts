export const markdownSchema = {
  type: 'object',
  description: 'Rich formatted text with markdown syntax support',
  properties: {
    content: {
      type: 'string',
      description:
        'Full markdown body (up to 10,000 characters). When the user pastes or provides source text, copy it verbatim into this field — do not summarize, shorten, or omit sections unless they explicitly ask for a summary.',
    }
  },
  required: ['content']
};

