import { Record } from 'neo4j-driver';
import { INeo4jComponentRelationship, INeo4jComponentNode, INeo4jComponentPath } from '../database/entities';
import { Neo4jComponentRelationship } from './Neo4jComponentRelationship';

export enum Neo4jDependencyType {
  NONE,
  DEPENDENCY,
  DEPENDENT,
}

export class Neo4jComponentPath {
  public source: INeo4jComponentNode;

  public containSourceEdges: INeo4jComponentRelationship[] = [];

  public dependencyEdges: Neo4jComponentRelationship[] = [];

  public containTargetEdges: INeo4jComponentRelationship[] = [];

  public target: INeo4jComponentNode;

  public readonly type: Neo4jDependencyType;

  /**
   * Given a list of Neo4j relationships, split those relationships into a 2D list
   * such that the first and last list only have "CONTAINS" relationships.
   * This is necessary to traverse up and down the "tree" of nodes.
   * If there are only "CONTAINS" relationships in the given list, the result will contain
   * two lists, one with relationships going "down" and the other going "up".
   * @param relationships
   * @param containEdgeName
   * @private
   */
  private groupAndSet(
    relationships: INeo4jComponentRelationship[],
    containEdgeName = 'CONTAINS',
  ) {
    if (relationships.length === 0) return;
    const chunks = [[relationships[0]]];
    for (let i = 1; i < relationships.length; i += 1) {
      if (relationships[i].type === chunks[chunks.length - 1][0].type) {
        chunks[chunks.length - 1].push(relationships[i]);
      } else {
        chunks.push([relationships[i]]);
      }
    }

    // No dependency edges, only containment edges. However, these might go down and immediately
    // go back up. Therefore, we need to find where to split this single array of CONTAIN edges
    if (chunks.length === 1 && chunks[0][0]?.type.toUpperCase() === containEdgeName) {
      const lastContainEdge = chunks[0][chunks[0].length - 1];
      const index = chunks[0].findIndex((e) => e.elementId === lastContainEdge.elementId);
      // The last CONTAIN edge in the chain exists only once, so we are not going back up.
      // Push an empty array.
      if (index === chunks[0].length - 1) {
        chunks.push([]);
      } else {
        const dependencyParents = chunks[0].splice(index + 1, chunks[0].length - 1 - index);
        chunks.push(dependencyParents);
      }
    } else {
      // If we do not start with any CONTAIN edges, push an empty array to the front to indicate
      // that we do not have such edges
      if (chunks[0][0].type.toUpperCase() !== containEdgeName) chunks.unshift([]);
      // If we do not end with any CONTAIN edges, push an empty array to the back to indicate
      // that we do not have such edges
      if (chunks[chunks.length - 1][0]?.type.toUpperCase() !== containEdgeName
        || chunks.length === 1) chunks.push([]);
    }

    // eslint-disable-next-line prefer-destructuring
    this.containSourceEdges = chunks[0];
    this.dependencyEdges = chunks.slice(1, chunks.length - 1).flat()
      .map((dep) => new Neo4jComponentRelationship(dep));
    this.containTargetEdges = chunks[chunks.length - 1];
  }

  constructor(record: Record<INeo4jComponentPath>) {
    this.source = record.get('source');
    this.target = record.get('target');

    this.groupAndSet(record.get('path'));

    const finalSourceModuleId = this
      .containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId
      ?? this.source.elementId;

    if (this.dependencyEdges[0]?.startNodeElementId === finalSourceModuleId) {
      this.type = Neo4jDependencyType.DEPENDENCY;
    } else if (this.dependencyEdges.length === 0) {
      this.type = Neo4jDependencyType.NONE;
    } else {
      this.type = Neo4jDependencyType.DEPENDENT;
    }
  }

  public get allEdges(): INeo4jComponentRelationship[] {
    return [...this.containSourceEdges, ...this.dependencyEdges.flat(), ...this.containTargetEdges];
  }

  public get sourceDepth(): number {
    return this.containSourceEdges.length;
  }

  public get targetDepth(): number {
    return this.containTargetEdges.length;
  }

  /**
   * Get the module element ID that is the starting point for this dependency.
   * Note that the source node does not necessarily have to be a module, as it
   * can also be a higher-layer element.
   */
  public get selectedModuleElementId(): string {
    if (this.type === Neo4jDependencyType.DEPENDENT) {
      return this.dependencyEdges.flat()[0]?.endNodeElementId
        ?? (this.containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId)
        ?? (this.containTargetEdges[this.containTargetEdges.length - 1]?.startNodeElementId);
    }
    return this.dependencyEdges.flat()[0]?.startNodeElementId
      ?? (this.containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId)
      ?? (this.containTargetEdges[this.containTargetEdges.length - 1]?.startNodeElementId);
  }
}
