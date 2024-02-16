import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import { DependencyCycle } from '../entities/violations';
import { Neo4jComponentDependency, Neo4jComponentNode } from '../database/entities';
import GraphProcessingService from './processing/GraphProcessingService';
import { ExtendedEdgeData } from '../entities/Edge';

interface Neo4jDependencyPath {
  start: Neo4jComponentNode,
  end: Neo4jComponentNode,
  segments: {
    start: Neo4jComponentNode,
    relationship: Neo4jComponentDependency,
    end: Neo4jComponentNode,
  }[]
}

export default class GraphViolationService {
  private readonly client: Neo4jClient;

  private readonly graphProcessingService: GraphProcessingService;

  constructor() {
    this.client = new Neo4jClient();
    this.graphProcessingService = new GraphProcessingService();
  }

  private formatDependencyCycles(
    records: Record<Neo4jDependencyPath>[],
  ): DependencyCycle[] {
    return records.map((r): DependencyCycle => {
      const start = r.get('start');
      return {
        node: this.graphProcessingService.formatNeo4jNodeToNodeData(start),
        path: r.get('segments').map((s): ExtendedEdgeData => ({
          ...this.graphProcessingService.formatNeo4jRelationshipToEdgeData(s.relationship),
          sourceNode: this.graphProcessingService.formatNeo4jNodeToNodeData(s.start),
          targetNode: this.graphProcessingService.formatNeo4jNodeToNodeData(s.end),
        })),
      };
    });
  }

  public async getDependencyCycles(elementIds: string[]): Promise<DependencyCycle[]> {
    const query = `
      MATCH (n WHERE elementId(n) IN [${elementIds.join(',')}])
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
