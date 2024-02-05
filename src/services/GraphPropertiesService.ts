import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import GraphProcessingService, { GraphFilterOptions } from './GraphProcessingService';
import { Neo4jComponentPath } from '../database/entities';
import GraphPostProcessingService from './GraphPostProcessingService';

export default class GraphPropertiesService {
  private readonly client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  private formatToLPG(name: string, options?: GraphFilterOptions) {
    return (records: Record<Neo4jComponentPath>[]) => new GraphProcessingService()
      .formatToLPG(records, name, options);
  }

  async getAllDomains() {
    const query = `
            MATCH (selectedNode:Domain)-[r1:CONTAINS*0..5]->(moduleOrLayer)-[r2*1..1]->(dependency:Module)   // Get all modules that belong to the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            WHERE NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) 
            RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target `;
    const graph = await this.client.executeAndProcessQuery(query, this.formatToLPG('All domains', { maxDepth: 0 }));
    await this.client.destroy();
    return new GraphPostProcessingService(graph).graph;
  }
}
