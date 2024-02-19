import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import { DependencyCycle } from '../entities/violations';
import { Neo4jComponentDependency, Neo4jComponentNode } from '../database/entities';
import GraphProcessingService from './processing/GraphProcessingService';
import { ExtendedEdgeData } from '../entities/Edge';

interface Neo4jDependencyPath {
  path: {
    start: Neo4jComponentNode,
    end: Neo4jComponentNode,
    segments: {
      start: Neo4jComponentNode,
      relationship: Neo4jComponentDependency,
      end: Neo4jComponentNode,
    }[],
  },
}

export default class GraphViolationService {
  private readonly client: Neo4jClient;

  private readonly graphProcessingService: GraphProcessingService;

  constructor(client?: Neo4jClient) {
    this.client = client ?? new Neo4jClient();
    this.graphProcessingService = new GraphProcessingService();
  }

  private formatDependencyCycles(
    records: Record<Neo4jDependencyPath>[],
  ): DependencyCycle[] {
    return records.map((r): DependencyCycle => {
      const { start, segments } = r.get('path');
      return {
        node: this.graphProcessingService.formatNeo4jNodeToNodeData(start),
        path: segments.map((s): ExtendedEdgeData => ({
          ...this.graphProcessingService.formatNeo4jRelationshipToEdgeData(s.relationship),
          sourceNode: this.graphProcessingService.formatNeo4jNodeToNodeData(s.start),
          targetNode: this.graphProcessingService.formatNeo4jNodeToNodeData(s.end),
        })),
        length: segments.length,
      };
    });
  }

  public async getDependencyCycles(elementIds?: string[]): Promise<DependencyCycle[]> {
    const whereClause = elementIds ? `WHERE elementId(n) IN [${elementIds.join(',')}]` : '';
    const query = `
      MATCH (n ${whereClause})
      WITH collect(n) as nodes
      CALL apoc.nodes.cycles(nodes)
      YIELD path
      RETURN path
    `;
    const records = await this.client
      .executeQuery<Neo4jDependencyPath>(query);
    return this.formatDependencyCycles(records);
  }
}
