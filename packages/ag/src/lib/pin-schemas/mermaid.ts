export const mermaidSchema = {
  type: 'object',
  description: 'Mermaid diagram for flowcharts, sequence diagrams, Gantt charts, state diagrams, and more. Documentation: https://mermaid.js.org/intro/',
  properties: {
    diagram: {
      type: 'string',
      description:
        'Mermaid diagram code using Mermaid syntax (use real line breaks in the string, not escaped \\\\n). Supports flowcharts (graph TD), sequence diagrams (sequenceDiagram), Gantt charts (gantt), state diagrams (stateDiagram-v2), class diagrams (classDiagram), ER diagrams (erDiagram), pie charts (pie), and git graphs (gitGraph). See https://mermaid.js.org/syntax/flowchart.html for full syntax reference.',
    },
    title: {
      type: 'string',
      description: 'Optional title displayed above the diagram'
    }
  },
  required: ['diagram']
};
