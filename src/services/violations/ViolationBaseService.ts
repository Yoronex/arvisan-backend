import { EdgeData } from '../../entities/Edge';
import { IntermediateGraph } from '../../entities';

export class ViolationBaseService {
  static replaceWithCorrectEdgeIds<T extends EdgeData>(
    violationEdge: T,
    graph: IntermediateGraph,
  ): T {
    const graphEdge = graph.edges
      .find((e) => e.data.source === violationEdge.source
        && e.data.target === violationEdge.target);
    if (graphEdge) {
      return {
        ...violationEdge,
        id: graphEdge.data.id,
      };
    }
    return violationEdge;
  }
}
