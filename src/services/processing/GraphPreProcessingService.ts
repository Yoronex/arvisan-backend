import { Record } from 'neo4j-driver';
import { INeo4jComponentPath } from '../../database/entities';
import { Neo4jComponentPath, Node } from '../../entities';
import GraphElementParserService from './GraphElementParserService';

import { MapSet } from '../../entities/MapSet';

export default class GraphPreProcessingService {
  public readonly nodes: MapSet<Node>;

  public readonly records: Neo4jComponentPath[];

  /**
   * @param records Unprocessed Neo4j paths
   * @param selectedId ID of the selected node (to highlight it)
   */
  constructor(
    records: Record<INeo4jComponentPath>[],
    public readonly selectedId?: string,
  ) {
    this.nodes = this.getAllNodes(records, selectedId);

    const chunkRecords = this.splitRelationshipsIntoChunks(records);
    this.records = this.onlyKeepLongestPaths(chunkRecords);
  }

  /**
   * Given a list of records, return a list of all unique nodes in the records
   * @param records
   * @param selectedId
   */
  private getAllNodes(records: Record<INeo4jComponentPath>[], selectedId?: string): MapSet<Node> {
    const nodeSet: MapSet<Node> = new MapSet();
    records.map((r) => [r.get('source'), r.get('target')]
      .forEach((field) => {
        const nodeId = field.elementId;
        if (nodeSet.has(nodeId)) return;
        nodeSet.set(nodeId, {
          data: GraphElementParserService.toNodeData(field, selectedId),
        });
      }));
    return nodeSet;
  }

  /**
   * Return the given records, but split/group the relationships into chunks of the same
   * type of relationship. See also this.groupRelationships().
   * @param records
   */
  private splitRelationshipsIntoChunks(
    records: Record<INeo4jComponentPath>[],
  ): Neo4jComponentPath[] {
    return records
      .map((record) => (new Neo4jComponentPath(record, this.nodes)));
  }

  /**
   * Keep only the paths that go from selected node to the domain node of the relationship
   * We have to delete any duplicates, because otherwise all these extra paths count towards
   * the total number of relationship a leaf has.
   * @param records
   */
  private onlyKeepLongestPaths(records: Neo4jComponentPath[]) {
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
