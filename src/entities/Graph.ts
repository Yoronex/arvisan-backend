import { Node } from './Node';
import { Edge } from './Edge';
import Violations from './violations';

/**
 * Graph as labelled property graph (cytoscape.js format)
 */
export interface Graph {
  name: string,
  nodes: Node[],
  edges: Edge[],
}

export interface GraphWithViolations {
  graph: Graph,
  violations: Violations,
}
