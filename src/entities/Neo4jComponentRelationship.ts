import { Integer } from 'neo4j-driver';
import { INeo4jComponentRelationship } from '../database/entities';
import { Node } from './Node';
import { EdgeViolations } from './Edge';
import { MapSet } from './MapSet';

export class Neo4jComponentRelationship implements INeo4jComponentRelationship {
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

  readonly originalRelationship: INeo4jComponentRelationship;

  readonly originalStartNode: Node;

  readonly originalEndNode: Node;

  /** Reference to the start node of this relationship */
  startNode: Node | undefined;

  /** Reference to the end node of this relationship */
  endNode: Node | undefined;

  /**
   * Reference to the parents of the start node.
   * The first element is the direct parent of the source node,
   * the second the parent of the parent, etc.
   */
  startNodeParents: Node[] = [];

  endNodeParents: Node[] = [];

  constructor(dep: INeo4jComponentRelationship, nodes: MapSet<Node>) {
    this.elementId = dep.elementId;
    this.startNodeElementId = dep.startNodeElementId;
    this.endNodeElementId = dep.endNodeElementId;
    this.type = dep.type;
    this.properties = dep.properties;
    this.identity = dep.identity;
    this.start = dep.start;
    this.end = dep.end;
    this.originalRelationship = dep;

    const startNode = nodes.get(this.startNodeElementId);
    if (startNode == null) throw new Error(`Start node (ID ${this.startNodeElementId}) for edge ${this.elementId} not found!`);
    this.startNode = startNode;
    this.originalStartNode = startNode;

    const endNode = nodes.get(this.endNodeElementId);
    if (endNode == null) throw new Error(`Start node (ID ${this.startNodeElementId}) for edge ${this.elementId} not found!`);
    this.endNode = endNode;
    this.originalEndNode = endNode;
  }

  setNodeReferences(nodes: MapSet<Node>) {
    this.startNode = nodes.get(this.startNodeElementId);
    this.endNode = nodes.get(this.endNodeElementId);
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
    rels: INeo4jComponentRelationship[],
    nodes: MapSet<Node>,
  ): Node[] {
    let parent: Node | undefined;
    if (currentNode.data.parent) {
      parent = nodes.get(currentNode.data.parent);
    } else {
      const rel = rels.find((r) => r.endNodeElementId === currentNode.data.id);
      if (rel) parent = nodes.get(rel.startNodeElementId);
    }
    if (!parent) return parents;
    return this.getParents(parent, [...parents, parent], rels, nodes);
  }

  findAndSetParents(nodes: MapSet<Node>, containRelationships: INeo4jComponentRelationship[]) {
    const startNode = nodes.get(this.startNodeElementId);
    if (startNode) {
      this.startNodeParents = this.getParents(startNode, [startNode], containRelationships, nodes);
    }
    const endNode = nodes.get(this.endNodeElementId);
    if (endNode) {
      this.endNodeParents = this.getParents(endNode, [endNode], containRelationships, nodes);
    }
  }

  getLayerNode(parents: Node[], layerName: string) {
    return parents.find((p) => p.data.properties.layer.includes(layerName));
  }
}
