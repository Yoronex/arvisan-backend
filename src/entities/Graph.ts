import { Node } from './Node';
import { Edge } from './Edge';

/**
 * Graph as labelled property graph (cytoscape.js format)
 */
export interface Graph {
  nodes: Node[],
  edges: Edge[],
}
