import { Record } from 'neo4j-driver';
import {
  INeo4jComponentRelationship,
  INeo4jComponentPath,
} from '../database/entities';
import { Neo4jDependencyRelationship } from './Neo4jDependencyRelationship';
import { MapSet } from './MapSet';
import Neo4jComponentNode from './Neo4jComponentNode';

export enum Neo4jDependencyType {
  NONE,
  OUTGOING,
  INCOMING,
}

export class Neo4jComponentPath {
  /** Start nodes of this path; From lowest level to highest level */
  public startNodes: Neo4jComponentNode[];

  /** Neo4j Containment edges, from highest level to lowest level. INVERSE FROM NODES */
  public containSourceEdges: INeo4jComponentRelationship[] = [];

  public dependencyEdges: Neo4jDependencyRelationship[] = [];

  /** Neo4j Containment edges, from highest level to lowest level. INVERSE FROM NODES */
  public containTargetEdges: INeo4jComponentRelationship[] = [];

  /** End nodes of this path; From lowest level to highest level */
  public endNodes: Neo4jComponentNode[];

  public readonly type: Neo4jDependencyType;

  /**
   * Given a list of Neo4j relationships, split those relationships into a 2D list
   * such that the first and last list only have "CONTAINS" relationships.
   * This is necessary to traverse up and down the "tree" of nodes.
   * If there are only "CONTAINS" relationships in the given list, the result will contain
   * two lists, one with relationships going "down" and the other going "up".
   * @param relationshipsToGroup
   * @param nodes
   * @param selectedDomain
   * @param containEdgeName
   * @private
   */
  private groupAndSet(
    relationshipsToGroup: INeo4jComponentRelationship[],
    nodes: MapSet<Neo4jComponentNode>,
    selectedDomain: boolean,
    containEdgeName = 'CONTAINS',
  ) {
    if (relationshipsToGroup.length === 0) return;
    const chunks = [[relationshipsToGroup[0]]];
    for (let i = 1; i < relationshipsToGroup.length; i += 1) {
      if (relationshipsToGroup[i].type === chunks[chunks.length - 1][0].type) {
        chunks[chunks.length - 1].push(relationshipsToGroup[i]);
      } else {
        chunks.push([relationshipsToGroup[i]]);
      }
    }

    // No dependency edges, only containment edges. However, these might go down and immediately
    // go back up. Therefore, we need to find where to split this single array of CONTAIN edges
    if (chunks.length === 1 && chunks[0][0]?.type.toUpperCase() === containEdgeName) {
      const lastContainEdge = chunks[0][chunks[0].length - 1];
      const index = chunks[0].findIndex((e) => e.elementId === lastContainEdge.elementId);
      // The last CONTAIN edge in the chain exists only once, so we are not going down.
      // Push an empty array.
      if (index === chunks[0].length - 1 && selectedDomain) {
        chunks.push([]);
      } else if (index === chunks[0].length - 1) {
        chunks.unshift([]);
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
    this.containTargetEdges = chunks[chunks.length - 1];
    this.dependencyEdges = chunks.slice(1, chunks.length - 1).flat()
      .map((dep) => new Neo4jDependencyRelationship(
        dep,
        nodes,
      ));
  }

  constructor(
    record: Record<INeo4jComponentPath>,
    nodes: MapSet<Neo4jComponentNode>,
    selectedDomain: boolean,
  ) {
    this.groupAndSet(record.get('path'), nodes, selectedDomain);

    let startNodeId: string | undefined;
    if (record.get('path').length === 0) {
      this.startNodes = [];
      this.endNodes = [];
    } else {
      // There exists at least one relationship. If not in the containment array,
      // it can be in the dependency array or in the target containment array
      startNodeId = this
        .containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId
        ?? this.dependencyEdges[0]?.startNode.elementId
        ?? this.containTargetEdges[this.containTargetEdges.length - 1]?.endNodeElementId;
      const startNode = nodes.get(startNodeId);
      if (startNode == null) {
        throw new Error(`Start node (ID ${startNodeId}) not found!`);
      }
      this.startNodes = startNode.getParents();

      const endNodeId = this
        .containTargetEdges[this.containTargetEdges.length - 1]?.endNodeElementId
        ?? this.dependencyEdges[this.dependencyEdges.length - 1]?.endNode.elementId
        ?? this.containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId;
      const endNode = nodes.get(endNodeId);
      if (endNode == null) {
        throw new Error(`End node (ID ${endNodeId}) not found!`);
      }
      this.endNodes = endNode.getParents();
    }

    const finalSourceModuleId = this
      .containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId
      ?? startNodeId;

    if (this.dependencyEdges[0]?.startNodeElementId === finalSourceModuleId) {
      this.type = Neo4jDependencyType.OUTGOING;
    } else if (this.dependencyEdges.length === 0) {
      this.type = Neo4jDependencyType.NONE;
    } else {
      this.type = Neo4jDependencyType.INCOMING;
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
    if (this.type === Neo4jDependencyType.INCOMING) {
      return this.dependencyEdges.flat()[0]?.endNodeElementId
        ?? (this.containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId)
        ?? (this.containTargetEdges[this.containTargetEdges.length - 1]?.startNodeElementId);
    }
    return this.dependencyEdges.flat()[0]?.startNodeElementId
      ?? (this.containSourceEdges[this.containSourceEdges.length - 1]?.endNodeElementId)
      ?? (this.containTargetEdges[this.containTargetEdges.length - 1]?.startNodeElementId);
  }

  /**
   * Perform edge lifting if necessary so the returned graph only has "depth" layers below
   * the selected node
   * @param depth
   */
  public liftEdges(depth: number) {
    const currentDepth = this.sourceDepth;
    if (currentDepth <= depth) return;

    const tooDeep = this.sourceDepth - depth;
    this.containSourceEdges.splice(-tooDeep);
    this.startNodes.splice(0, tooDeep);
    this.containTargetEdges.splice(-tooDeep);
    this.endNodes.splice(0, tooDeep);
    this.dependencyEdges.forEach((e) => e.liftRelationship(tooDeep));
  }
}
