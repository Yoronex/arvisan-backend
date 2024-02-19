import { NodeData } from './Node';

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
    /** Whether this edge is some architectural violation */
    violation: 'true' | 'false';
  },
}

export interface ExtendedEdgeData extends EdgeData {
  /** Source node object */
  sourceNode: NodeData,
  /** Target node object */
  targetNode: NodeData,
}
