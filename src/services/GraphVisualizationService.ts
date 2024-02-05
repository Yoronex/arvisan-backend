import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import { Graph } from '../entities/Graph';
import GraphProcessingService, { GraphFilterOptions } from './GraphProcessingService';
import { Neo4jComponentPath } from '../database/entities';
import GraphPostProcessingService from './GraphPostProcessingService';

export interface QueryOptions {
  id: string;
  layerDepth: number,
  dependencyDepth: number,
  onlyInternalRelations?: boolean,
  onlyExternalRelations?: boolean,
  showDependencies?: boolean,
  showDependents?: boolean,
  dependencyRange?: {
    min?: number;
    max?: number;
  },
  dependentRange?: {
    min?: number;
    max?: number;
  },
  selfEdges?: boolean,
}

export default class GraphVisualizationService {
  private client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  private formatToLPG(name: string, options?: GraphFilterOptions) {
    return (records: Record<Neo4jComponentPath>[]) => new GraphProcessingService()
      .formatToLPG(records, name, options);
  }

  private async getParents(id: string) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')<-[r:CONTAINS*0..5]-(selectedParent) 
      RETURN selectedNode as source, r as path, selectedParent as target`;
    return this.client.executeAndProcessQuery(query, this.formatToLPG('All parents', { selectedId: id }));
  }

  private async getChildren(id: string, depth: number) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r:CONTAINS*0..${depth}]->(moduleOrLayer) 
      RETURN selectedNode as source, r as path, moduleOrLayer as target`;
    return this.client.executeAndProcessQuery(query, this.formatToLPG('All sublayers and modules', { selectedId: id }));
  }

  public async getGraphFromSelectedNode({
    id, layerDepth, dependencyDepth, onlyExternalRelations, onlyInternalRelations,
    showDependencies, showDependents, dependencyRange, dependentRange, selfEdges,
  }: QueryOptions) {
    const buildQuery = (dependencies: boolean = true) => {
      let query = `
            MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r1:CONTAINS*0..5]->(moduleOrLayer)${!dependencies ? '<' : ''}-[r2*1..${dependencyDepth}]-${dependencies ? '>' : ''}(dependency:Module) // Get all modules that belong to the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            WHERE true `;
      if (onlyInternalRelations) {
        query += 'AND (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should be in the same domain
      }
      if (onlyExternalRelations) {
        query += 'AND NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should not be in the same domain
      }

      if (dependencies) {
        query += 'RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target';
      } else {
        query += 'RETURN DISTINCT parent as source, reverse(r3) + r2 + r1 as path, selectedNode as target';
      }
      return query;
    };

    const promises: Promise<Graph>[] = [
      this.getChildren(id, layerDepth),
      this.getParents(id),
    ];
    if (showDependencies) {
      promises.push(this.client.executeAndProcessQuery(buildQuery(true), this.formatToLPG('All dependencies and their parents', {
        selectedId: id,
        maxDepth: layerDepth,
        minRelationships: dependencyRange?.min,
        maxRelationships: dependencyRange?.max,
        selfEdges,
      })));
    }
    if (showDependents) {
      promises.push(this.client.executeAndProcessQuery(buildQuery(false), this.formatToLPG('All dependents and their parents', {
        selectedId: id,
        maxDepth: layerDepth,
        reverseDirection: true,
        minRelationships: dependentRange?.min,
        maxRelationships: dependentRange?.max,
        selfEdges,
      })));
    }

    const graphs = await Promise.all(promises);
    await this.client.destroy();

    return new GraphPostProcessingService(...graphs).graph;
  }
}
