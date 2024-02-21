import { Record } from 'neo4j-driver';
import { Neo4jComponentPath } from '../../database/entities';
import { Neo4jComponentPathWithChunks, Node } from '../../entities';
import GraphElementParserService from './GraphElementParserService';

export default class GraphPreProcessingService {
  public readonly nodes: Node[];

  public readonly records: Neo4jComponentPathWithChunks[];

  /**
   * @param records Unprocessed Neo4j paths
   * @param selectedId ID of the selected node (to highlight it)
   * @param addNodeReferences Whether each relationship in each path should get a
   * reference to its start and end nodes. Disable if it is not needed to increase
   * performance.
   */
  constructor(
    records: Record<Neo4jComponentPath>[],
    selectedId?: string,
    addNodeReferences = true,
  ) {
    this.nodes = this.getAllNodes(records, selectedId);

    const chunkRecords = this.splitRelationshipsIntoChunks(records, addNodeReferences);
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
   * Return the given records, but split/group the relationships into chunks of the same
   * type of relationship. See also this.groupRelationships().
   * @param records
   * @param addNodeReferences Whether each relationship in each path should get a
   * reference to its start and end nodes. Disable if it is not needed to increase
   * performance.
   */
  private splitRelationshipsIntoChunks(
    records: Record<Neo4jComponentPath>[],
    addNodeReferences = true,
  ): Neo4jComponentPathWithChunks[] {
    const newRecords = records
      .map((record) => (new Neo4jComponentPathWithChunks(record)));
    if (addNodeReferences) {
      const neo4jNodes = newRecords.map((r) => [r.source, r.target]).flat();
      newRecords.forEach((r) => r.dependencyEdges.flat()
        .forEach((d) => d.setNodeReferences(neo4jNodes)));
    }
    return newRecords;
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
        // String that will uniquely identify this dependency (sequence).
        const pathId = record.dependencyEdges.flat().map((e) => e.elementId).join(',');

        let currDepth = 0;
        if (seenPaths.has(pathId)) {
          currDepth = seenPaths.get(pathId)!;
        }

        seenPaths.set(pathId, Math.max(currDepth, record.targetDepth));

        return record;
      }).filter((record) => {
        const pathId = record.dependencyEdges.flat().map((e) => e.elementId).join(',');
        const depth = seenPaths.get(pathId) || 0;

        return record.targetDepth === depth;
      });
  }
}
