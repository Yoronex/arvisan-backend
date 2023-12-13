export interface Edge {
  data: EdgeData,
}

export interface EdgeData {
  id: string,
  source: string,
  target: string,
  label: string,
  properties: {
    weight: 1,
    traces: string[],
  },
}
