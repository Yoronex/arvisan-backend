export interface Edge {
  data: EdgeData,
}

export interface EdgeData {
  /** Unique edge identifier */
  id: string,
  /** Identifier of source node */
  source: string,
  /** Identifier of target node */
  target: string,
  /** Edge label */
  interaction: string,
  /** Custom properties */
  properties: {
    /** Edge weight */
    weight: number,
  },
}
