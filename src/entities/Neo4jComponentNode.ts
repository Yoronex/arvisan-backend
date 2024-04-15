import { Integer } from 'neo4j-driver';
import { INeo4jComponentNode, INeo4jNodeProperties, Neo4jRelationshipMappings } from '../database/entities';
import { MapSet } from './MapSet';
import ElementParserService from '../services/processing/ElementParserService';

export default class Neo4jComponentNode implements INeo4jComponentNode {
  elementId: string;

  identity: Integer;

  labels: string[];

  layer: string;

  properties: INeo4jNodeProperties;

  parent: Neo4jComponentNode | null = null;

  children: Neo4jComponentNode[] = [];

  originalNodeBeforeLifting: Neo4jComponentNode | undefined;

  dependencyProfile: [number, number, number, number];

  selected: boolean;

  /** Whether this node is contained in the selected node (can be too deep) */
  inSelection: boolean;

  constructor(node: INeo4jComponentNode, selectedId?: string) {
    this.elementId = node.elementId;
    this.identity = node.identity;
    this.labels = node.labels;
    this.layer = ElementParserService.getLongestLabel(node.labels);
    this.properties = node.properties;
    this.selected = node.elementId === selectedId;
    this.inSelection = this.selected;

    this.dependencyProfile = ElementParserService
      .toDependencyProfile(node.properties.dependencyProfileCategory);
  }

  /**
   * Set a reference to this node's parent and children nodes
   * @param allNodes
   * @param containRelationships
   */
  setParentChildNodes(
    allNodes: MapSet<Neo4jComponentNode>,
    containRelationships: Neo4jRelationshipMappings,
  ): void {
    const parentId = containRelationships.targetToSource.get(this.elementId);
    this.parent = parentId ? allNodes.get(parentId) ?? null : null;

    const childIds = containRelationships.sourceToTargets.get(this.elementId) ?? [];
    this.children = childIds.map((childId) => allNodes.get(childId))
      .filter((n) => n !== undefined)
      .map((n) => n!);
  }

  /**
   * Given a node ID, set this.inSelection to true if one of this node's parent has the given ID
   * @param selectedId
   */
  markIfInSelection(selectedId: string): void {
    const parentIds = this.getAncestors().map((p) => p.elementId);
    if (parentIds.includes(selectedId)) {
      this.inSelection = true;
    }
  }

  /**
   * Get a list of all parents of this node, including itself, ordered from lowest to highest level
   */
  getAncestors(): Neo4jComponentNode[] {
    if (this.parent) {
      return [this, ...this.parent.getAncestors()];
    }
    return [this];
  }

  /**
   * Get the top-level parent of this node. Returns itself if it is already top-level
   */
  getRootAncestor(): Neo4jComponentNode {
    const parents = this.getAncestors();
    return parents[parents.length - 1];
  }

  /**
   * Get a list of all children of this node, including itself, ordered from highest to lowest level
   * @param depth Max depth from the parent node.
   * 0 if no children should be selected. Undefined if no limit
   */
  getDescendants(depth?: number): Neo4jComponentNode[] {
    if (depth !== undefined && depth <= 0) return [this];
    if (this.children.length === 0) return [this];
    const allChildren = this.children
      .reduce((children: Neo4jComponentNode[], child) => children.concat(
        child.getDescendants(depth ? depth - 1 : undefined),
      ), []);
    return [this as Neo4jComponentNode].concat(allChildren);
  }

  /**
   * Get the node that belongs in the given upper layer.
   * Undefined if it does not exist, i.e. when the node is in a lower layer.
   * @param layerName
   */
  getLayerAncestor(layerName: string) {
    return this.getAncestors().find((p) => p.labels.includes(layerName));
  }

  /**
   * Get a list of all children of this node that do not have children themselves
   */
  getLeafDescendants(): Neo4jComponentNode[] {
    return this.getDescendants().filter((n) => n.children.length === 0);
  }
}
