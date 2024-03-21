import { Node } from './Node';
import { Edge } from './Edge';
import Violations from './violations';
import { MapSet } from './MapSet';
import Neo4jComponentNode from './Neo4jComponentNode';

/**
 * Graph as labelled property graph (cytoscape.js format)
 */
export interface Graph {
  name: string,
  nodes: Node[],
  edges: Edge[],
}

export interface IntermediateGraph {
  name: string,
  nodes: MapSet<Neo4jComponentNode>,
  edges: MapSet<Edge>,
}

export interface GraphWithViolations {
  graph: Graph,
  violations: Violations,
}

export interface IntermediateGraphWithViolations {
  graph: IntermediateGraph,
  violations: Violations,
}
