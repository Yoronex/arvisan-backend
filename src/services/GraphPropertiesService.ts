import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import GraphProcessingService from './GraphProcessingService';
import { Neo4jComponentPath } from '../database/entities';
import { Domain } from '../entities';

export default class GraphPropertiesService {
  private readonly client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  private formatDomains() {
    return (records: Record<Neo4jComponentPath>[]): Domain[] => {
      const { nodes, edges } = new GraphProcessingService().formatToLPG(records, 'All domains', {
        maxDepth: 0,
        selfEdges: true,
      });

      return nodes.map((node): Domain => ({
        ...node.data,
        nrDependencies: edges
          .filter((e) => e.data.source === node.data.id && e.data.target !== node.data.id)
          .reduce((total, e) => total + e.data.properties.weight, 0),
        nrDependents: edges
          .filter((e) => e.data.source !== node.data.id && e.data.target === node.data.id)
          .reduce((total, e) => total + e.data.properties.weight, 0),
        nrInternalDependencies: edges
          .filter((e) => e.data.source === node.data.id && e.data.target === node.data.id)
          .reduce((total, e) => total + e.data.properties.weight, 0),
      }));
    };
  }

  async getDomains() {
    const query = `
            MATCH (selectedNode:Domain)-[r1:CONTAINS*0..5]->(moduleOrLayer)-[r2*1..1]->(dependency:Module)   // Get all modules that belong to the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target `;
    const domains = await this.client.executeAndProcessQuery(query, this.formatDomains());
    await this.client.destroy();
    return domains;
  }
}
