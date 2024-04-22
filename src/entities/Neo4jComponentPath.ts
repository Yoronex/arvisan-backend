import { Record } from 'neo4j-driver';
import {
  INeo4jComponentRelationship,
  INeo4jComponentPath,
} from '../database/entities';
import { Neo4jDependencyRelationship } from './Neo4jDependencyRelationship';
import { MapSet } from './MapSet';
import Neo4jComponentNode from './Neo4jComponentNode';

export class Neo4jComponentPath {
  /** Start nodes of this path; From lowest level to highest level */
  public startNodes: Neo4jComponentNode[];

  public sourceDepth: number;

  public dependencyEdges: Neo4jDependencyRelationship[];

  public targetDepth: number;

  /** End nodes of this path; From lowest level to highest level */
  public endNodes: Neo4jComponentNode[];

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
    if (relationshipsToGroup.length === 0) {
      return {
        containSourceEdges: [],
        containTargetEdges: [],
        dependencyEdges: [],
      };
    }
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
    const containSourceEdges = chunks[0];
    const containTargetEdges = chunks[chunks.length - 1];
    const dependencyEdges = chunks.slice(1, chunks.length - 1).flat()
      .map((dep) => new Neo4jDependencyRelationship(
        dep,
        nodes,
      ));

    return {
      containSourceEdges,
      containTargetEdges,
      dependencyEdges,
    };
  }

  constructor(
    record: Record<INeo4jComponentPath>,
    nodes: MapSet<Neo4jComponentNode>,
    selectedDomain: boolean,
  ) {
    const {
      containSourceEdges, containTargetEdges, dependencyEdges,
    } = this.groupAndSet(record.get('path'), nodes, selectedDomain);

    this.dependencyEdges = dependencyEdges;
    this.sourceDepth = containSourceEdges.length;
    this.targetDepth = containTargetEdges.length;

    let startNodeId: string | undefined;
    if (record.get('path').length === 0) {
      this.startNodes = [];
      this.endNodes = [];
    } else {
      // There exists at least one relationship. If not in the containment array,
      // it can be in the dependency array or in the target containment array
      startNodeId = containSourceEdges[containSourceEdges.length - 1]?.endNodeElementId
        ?? dependencyEdges[0]?.startNode.elementId
        ?? containTargetEdges[containTargetEdges.length - 1]?.endNodeElementId;
      const startNode = nodes.get(startNodeId);
      if (startNode == null) {
        throw new Error(`Start node (ID ${startNodeId}) not found!`);
      }
      this.startNodes = startNode.getAncestors();

      const endNodeId = containTargetEdges[containTargetEdges.length - 1]?.endNodeElementId
        ?? dependencyEdges[dependencyEdges.length - 1]?.endNode.elementId
        ?? containSourceEdges[containSourceEdges.length - 1]?.endNodeElementId;
      const endNode = nodes.get(endNodeId);
      if (endNode == null) {
        throw new Error(`End node (ID ${endNodeId}) not found!`);
      }
      this.endNodes = endNode.getAncestors();
    }
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
    this.sourceDepth -= tooDeep;
    this.startNodes.splice(0, tooDeep);
    this.targetDepth -= tooDeep;
    this.endNodes.splice(0, tooDeep);
    this.dependencyEdges.forEach((e) => e.liftRelationship(tooDeep));
  }
}
