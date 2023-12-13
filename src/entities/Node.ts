export interface Node {
  data: NodeData,
}

export interface NodeData {
  id: string,
  labels: string[],
  properties: {
    simpleName: string,
    kind: string,
    traces: string[],
    color: string,
    depth: number,
    selected: 'true' | 'false',
  },
}
