export const chartsSchema = {
  type: 'object',
  description: 'Universal chart component supporting line, bar, area, pie, and radar charts',
  properties: {
    chartType: {
      type: 'string',
      enum: ['line', 'bar', 'area', 'stacked-area', 'pie', 'radar', 'scatter', 'horizontal-bar'],
      description: 'Type of chart to display. stacked-area = multiple series stacked on the Y axis. scatter = numeric x/y plot (optional z for dot size). horizontal-bar = ranked horizontal bars.'
    },
    title: {
      type: 'string',
      description: 'Chart title'
    },
    xAxis: {
      type: 'string',
      description:
        'X axis label (line/bar/area) OR legacy category field name on pie slices. For pie charts prefer each data row: { "name": "Category label", "value": number }.'
    },
    yAxis: {
      type: 'string',
      description: 'Y axis label (line/bar/area). Optional label for pie charts.'
    },
    dataKeys: {
      type: 'array',
      items: {
        type: 'string'
      },
      description:
        'Series keys to plot. For pie charts use ["value"] and put the slice size in each row\'s value field.'
    },
    data: {
      type: 'array',
      items: {
        type: 'object'
      },
      description:
        'Data rows. Pie: [{ "name": "Product A", "value": 35 }, ...]. Scatter: [{ "x": 100, "y": 200, "z": 200, "name": "A" }, ...]. Line/bar/area: include name plus keys listed in dataKeys.'
    }
  },
  required: ['chartType', 'xAxis', 'yAxis', 'dataKeys', 'data']
};






















