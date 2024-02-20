import { Record } from 'neo4j-driver';
import { Neo4jComponentDependency, Neo4jComponentPath, Neo4jComponentPathWithChunks } from '../../database/entities';
import { Node } from '../../entities';
import GraphElementParserService from './GraphElementParserService';

export default class GraphPreProcessingService {
  public readonly nodes: Node[];

  public readonly records: Neo4jComponentPathWithChunks[];

  constructor(records: Record<Neo4jComponentPath>[], selectedId?: string) {
    this.nodes = this.getAllNodes(records, selectedId);

    const chunkRecords = this.splitRelationshipsIntoChunks(records);
    this.records = this.onlyKeepLongestPaths(chunkRecords);
  }

  /**
   * Given a list of records, return a list of all unique nodes in the records
   * @param records
   * @param selectedId
   */
  private getAllNodes(records: Record<Neo4jComponentPath>[], selectedId?: string): Node[] {
    const seenNodes: string[] = [];
    return records
      .map((r) => [r.get('source'), r.get('target')]
        .map((field): Node | undefined => {
          const nodeId = field.elementId;
          if (seenNodes.indexOf(nodeId) >= 0) return undefined;
          seenNodes.push(nodeId);
          return {
            data: GraphElementParserService.formatNeo4jNodeToNodeData(field, selectedId),
          };
        }))
      .flat()
      .filter((node) => node !== undefined) as Node[];
  }

  /**
   * Given a list of Neo4j relationships, split those relationships into a 2D list
   * such that the first and last list only have "CONTAINS" relationships.
   * This is necessary to traverse up and down the "tree" of nodes.
   * If there are only "CONTAINS" relationships in the given list, the result will contain
   * two lists, one with relationships going "down" and the other going "up".
   * @param relationships
   * @param reverseDirection
   * @private
   */
  private groupRelationships(
    relationships: Neo4jComponentDependency[],
    reverseDirection?: boolean,
  ): Neo4jComponentDependency[][] {
    if (relationships.length === 0) return [[]];
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
    if (chunks.length === 1) {
      const lastContainEdge = chunks[0][chunks[0].length - 1];
      const index = chunks[0].findIndex((e) => e.elementId === lastContainEdge.elementId);
      // The last CONTAIN edge in the chain exists only once, so we are not going back up.
      // Push an empty array.
      if (index === chunks[0].length - 1 && !reverseDirection) {
        chunks.push([]);
      } else if (index === chunks[0].length - 1) {
        chunks.unshift([]);
      } else if (!reverseDirection) {
        const dependencyParents = chunks[0].splice(index + 1, chunks[0].length - 1 - index);
        chunks.push(dependencyParents);
      } else {
        const dependencyParents = chunks[0].splice(0, index);
        chunks.unshift(dependencyParents);
      }
    } else {
      // If we do not start with any CONTAIN edges, push an empty array to the front to indicate
      // that we do not have such edges
      if (chunks[0][0].type.toLowerCase() !== 'contains') chunks.unshift([]);
      // If we do not end with any CONTAIN edges, push an empty array to the back to indicate
      // that we do not have such edges
      if (chunks[chunks.length - 1][0]?.type.toLowerCase() !== 'contains' || chunks.length === 1) chunks.push([]);
    }
    return chunks;
  }

  /**
   * Return the given records, but split/group the relationships into chunks of the same
   * type of relationship. See also this.groupRelationships().
   * @param records
   */
  private splitRelationshipsIntoChunks(
    records: Record<Neo4jComponentPath>[],
  ): Neo4jComponentPathWithChunks[] {
    return records
      .map((record) => record.toObject())
      .map((record) => ({
        source: record.source,
        chunks: this.groupRelationships(record.path),
        target: record.target,
      }));
  }

  /**
   * Keep only the paths that go from selected node to the domain node of the relationship
   * We have to delete any duplicates, because otherwise all these extra paths count towards
   * the total number of relationship a leaf has.
   * @param records
   */
  private onlyKeepLongestPaths(records: Neo4jComponentPathWithChunks[]) {
    const seenPaths = new Map<string, number>();
    return records
      .map((record) => {
        const { chunks } = record;
        // String that will uniquely identify this dependency (sequence).
        const pathId = chunks.slice(1, chunks.length - 1).flat().map((e) => e.elementId).join(',');

        let currDepth = 0;
        if (seenPaths.has(pathId)) {
          currDepth = seenPaths.get(pathId)!;
        }

        seenPaths.set(pathId, Math.max(currDepth, chunks[chunks.length - 1].length));

        return record;
      }).filter((record) => {
        const { chunks } = record;
        const pathId = chunks.slice(1, chunks.length - 1).flat().map((e) => e.elementId).join(',');
        const depth = seenPaths.get(pathId) || 0;

        return chunks[chunks.length - 1].length === depth;
      });
  }
}
