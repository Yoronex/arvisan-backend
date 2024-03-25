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

  dependencyProfile: [number, number, number, number];

  selected: boolean;

  constructor(node: INeo4jComponentNode, selectedId?: string) {
    this.elementId = node.elementId;
    this.identity = node.identity;
    this.labels = node.labels;
    this.layer = ElementParserService.getLongestLabel(node.labels);
    this.properties = node.properties;
    this.selected = node.elementId === selectedId;

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
   * Get a list of all parents of this node, including itself
   */
  getParents(): Neo4jComponentNode[] {
    if (this.parent) {
      return [this, ...this.parent.getParents()];
    }
    return [this];
  }

  getLayerNode(layerName: string) {
    return this.getParents().find((p) => p.labels.includes(layerName));
  }
}
