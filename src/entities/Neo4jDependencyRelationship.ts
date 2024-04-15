import { Integer } from 'neo4j-driver';
import {
  DependencyType,
  INeo4jComponentRelationship,
  INeo4jRelationshipProperties,
} from '../database/entities';
import { EdgeDataProperties, EdgeViolations } from './Edge';
import { MapSet } from './MapSet';
import Neo4jComponentNode from './Neo4jComponentNode';

export class Neo4jDependencyRelationship implements INeo4jComponentRelationship {
  private static DEPENDENCY_PARENTS_DEPTH: number | undefined;

  elementId: string;

  readonly originalElementId: string;

  /**
   * @deprecated use endNode.elementId instead
   */
  endNodeElementId: string;

  /**
   * @deprecated use endNode.elementId instead
   */
  startNodeElementId: string;

  type: string;

  readonly properties: INeo4jRelationshipProperties;

  edgeProperties: Omit<EdgeDataProperties, 'violations'>;

  violations: EdgeViolations = {
    subLayer: false,
    dependencyCycle: false,
  };

  identity: Integer;

  start: Integer;

  end: Integer;

  readonly originalRelationship: INeo4jComponentRelationship;

  readonly originalStartNode: Neo4jComponentNode;

  readonly originalEndNode: Neo4jComponentNode;

  /** Reference to the start node of this relationship */
  startNode: Neo4jComponentNode;

  /** Reference to the end node of this relationship */
  endNode: Neo4jComponentNode;

  constructor(
    dep: INeo4jComponentRelationship,
    nodes: MapSet<Neo4jComponentNode>,
  ) {
    this.elementId = dep.elementId;
    this.originalElementId = dep.elementId;
    this.startNodeElementId = dep.startNodeElementId;
    this.endNodeElementId = dep.endNodeElementId;
    this.type = dep.type;
    this.properties = dep.properties;
    const references: Record<string, string[]> = JSON.parse(dep.properties.references);
    this.edgeProperties = {
      references: Object.entries(references).map(([type, names]) => ({ type, names })),
      dependencyTypes: dep.properties.dependencyTypes
        ? dep.properties.dependencyTypes.split('|') as DependencyType[] : [],
      nrModuleDependencies: 1,
      nrFunctionDependencies: Number(dep.properties.nrDependencies) || 1,
      nrCalls: Number(dep.properties.nrCalls) || undefined,
    };
    this.identity = dep.identity;
    this.start = dep.start;
    this.end = dep.end;
    this.originalRelationship = dep;

    const startNode = nodes.get(dep.startNodeElementId);
    if (startNode == null) {
      throw new Error(`Start node (ID ${dep.startNodeElementId}) for edge ${this.elementId} not found!`);
    }
    Neo4jDependencyRelationship.validateParentDepth(startNode.getAncestors().length);
    this.startNode = startNode;
    this.originalStartNode = startNode;

    const endNode = nodes.get(dep.endNodeElementId);
    if (endNode == null) {
      throw new Error(`End node (ID ${dep.endNodeElementId}) for edge ${this.elementId} not found!`);
    }
    Neo4jDependencyRelationship.validateParentDepth(endNode.getAncestors().length);
    this.endNode = endNode;
    this.originalEndNode = endNode;
  }

  /**
   * Sanity check that all leaf nodes (where the dependency relationship exists)
   * are on the same level. This is essential to correctly perform edge lifting
   * @param depth Number of parents this node has (including itself)
   */
  static validateParentDepth(depth: number) {
    if (this.DEPENDENCY_PARENTS_DEPTH === undefined) {
      this.DEPENDENCY_PARENTS_DEPTH = depth;
    } else if (this.DEPENDENCY_PARENTS_DEPTH !== depth) {
      throw new Error(`Expected relationship to have a parent depth of ${this.DEPENDENCY_PARENTS_DEPTH}, but found ${depth}`);
    }
  }

  /**
   * Perform edge lifting on this relationship by replacing the start and end nodes
   * by their parents "levels" levels up
   * @param levels Level of parent that becomes the new source/target node
   */
  liftRelationship(levels: number) {
    if (levels <= 0) return;

    const sourceParents = this.originalStartNode.getAncestors();
    const targetParents = this.originalEndNode.getAncestors();
    if (levels >= sourceParents.length || levels >= targetParents.length) {
      throw new Error(`Try to lift dependency ${this.elementId} levels, but relationship is only ${Math.min(sourceParents.length, targetParents.length)} deep.`);
    }

    this.startNode = sourceParents[levels];
    this.startNodeElementId = this.startNode.elementId;
    this.startNode.originalNodeBeforeLifting = this.originalStartNode;

    this.endNode = targetParents[levels];
    this.endNodeElementId = this.endNode.elementId;
    this.endNode.originalNodeBeforeLifting = this.originalEndNode;
  }

  /**
   * Merge this dependency's edgeProperties with those of another edge in-place
   * @param edgeProperties
   */
  mergeProperties(edgeProperties: Omit<EdgeDataProperties, 'violations'>) {
    this.edgeProperties.nrModuleDependencies += edgeProperties.nrModuleDependencies;
    this.edgeProperties.nrFunctionDependencies += edgeProperties.nrFunctionDependencies;

    this.edgeProperties.dependencyTypes = this.edgeProperties.dependencyTypes
      .concat(...edgeProperties.dependencyTypes);
    edgeProperties.references.forEach(({ type, names }) => {
      const index = this.edgeProperties.references.findIndex((r) => r.type === type);
      if (index < 0) {
        this.edgeProperties.references.push({ type, names });
      } else {
        this.edgeProperties.references[index].names.push(...names);
      }
    });
  }
}
