export interface Node {
  data: NodeData,
}

export interface NodeData {
  /** Unique node identifier */
  id: string,
  /** Node label (name) */
  label: string,
  /** Custom properties of node */
  properties: {
    /** Type of node */
    kind: string,
    /** Layer this node is in */
    layer: string,
    /** Hex color this node should be */
    color: string,
    /** Node layer depth */
    depth: number,
    /** Whether this node is selected or not */
    selected: 'true' | 'false',
  },
}
