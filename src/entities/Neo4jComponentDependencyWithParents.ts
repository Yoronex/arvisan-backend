import { Integer } from 'neo4j-driver';
import { Neo4jComponentDependency, Neo4jComponentNode } from '../database/entities';
import { Node } from './Node';
import { EdgeViolations } from './Edge';

export class Neo4jComponentDependencyWithParents implements Neo4jComponentDependency {
  elementId: string;

  endNodeElementId: string;

  startNodeElementId: string;

  type: string;

  properties: { id: string };

  violations: EdgeViolations = {
    subLayer: false,
  };

  identity: Integer;

  start: Integer;

  end: Integer;

  readonly originalRelationship: Neo4jComponentDependency;

  /** Reference to the start node of this relationship */
  startNode: Neo4jComponentNode | undefined;

  /** Reference to the end node of this relationship */
  endNode: Neo4jComponentNode | undefined;

  /**
   * Reference to the parents of the start node.
   * The first element is the direct parent of the source node,
   * the second the parent of the parent, etc.
   * Undefined if there is no startNode.
   */
  startNodeParents: Node[] | undefined;

  endNodeParents: Node[] | undefined;

  constructor(dep: Neo4jComponentDependency) {
    this.elementId = dep.elementId;
    this.startNodeElementId = dep.startNodeElementId;
    this.endNodeElementId = dep.endNodeElementId;
    this.type = dep.type;
    this.properties = dep.properties;
    this.identity = dep.identity;
    this.start = dep.start;
    this.end = dep.end;
    this.originalRelationship = dep;
  }

  setNodeReferences(nodes: Neo4jComponentNode[]) {
    this.startNode = nodes.find((n) => n.elementId === this.startNodeElementId);
    if (this.startNode) this.startNodeParents = [];
    this.endNode = nodes.find((n) => n.elementId === this.endNodeElementId);
    if (this.endNode) this.endNodeParents = [];
  }

  /**
   * Get all the given node's parent nodes, if they exist.
   * @param currentNode
   * @param parents The already found parents
   * @param rels All "CONTAINS" relationships existing in the graph.
   * Required in case node.parent relationships are not (yet) defined.
   * @param nodes All nodes in the graph
   * @private
   */
  private getParents(
    currentNode: Node,
    parents: Node[],
    rels: Neo4jComponentDependency[],
    nodes: Node[],
  ): Node[] {
    let parent: Node | undefined;
    if (currentNode.data.parent) {
      parent = nodes.find((n) => n.data.id === currentNode.data.parent);
    } else {
      const rel = rels.find((r) => r.endNodeElementId === currentNode.data.id);
      if (rel) parent = nodes.find((n) => n.data.id === rel.startNodeElementId);
    }
    if (!parent) return parents;
    return this.getParents(parent, [...parents, parent], rels, nodes);
  }

  findAndSetParents(nodes: Node[], containRelationships: Neo4jComponentDependency[]) {
    const startNode = nodes.find((n) => n.data.id === this.startNodeElementId);
    if (startNode) {
      this.startNodeParents = this.getParents(startNode, [startNode], containRelationships, nodes);
    }
    const endNode = nodes.find((n) => n.data.id === this.endNodeElementId);
    if (endNode) {
      this.endNodeParents = this.getParents(endNode, [endNode], containRelationships, nodes);
    }
  }

  getLayerNode(parents: Node[], layerName: string) {
    return parents.find((p) => p.data.properties.layer.includes(layerName));
  }
}
