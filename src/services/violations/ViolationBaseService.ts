import { EdgeData } from '../../entities/Edge';
import { Neo4jComponentPath } from '../../entities';

export class ViolationBaseService {
  static replaceWithCorrectEdgeIds<T extends EdgeData>(
    violationEdge: T,
    records: Neo4jComponentPath[],
  ): T {
    const dependencyRelationships = records.map((r) => r.dependencyEdges).flat();
    const graphEdge = dependencyRelationships
      .find((e) => e.startNodeElementId === violationEdge.source
        && e.endNodeElementId === violationEdge.target);
    if (graphEdge) {
      return {
        ...violationEdge,
        id: graphEdge.elementId,
      };
    }
    return violationEdge;
  }
}
