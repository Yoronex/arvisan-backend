import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import { Graph, Neo4jComponentPathWithChunks } from '../entities';
import GraphProcessingService, { GraphFilterOptions, Range } from './processing/GraphProcessingService';
import { Neo4jComponentPath } from '../database/entities';
import GraphPostProcessingService from './processing/GraphPostProcessingService';
import GraphViolationService from './GraphViolationService';
import Violations from '../entities/violations';
import { GraphWithViolations } from '../entities/Graph';
import GraphPreProcessingService from './processing/GraphPreProcessingService';

export interface QueryOptions {
  id: string;
  layerDepth: number,
  dependencyDepth: number,
  onlyInternalRelations?: boolean,
  onlyExternalRelations?: boolean,
  showDependencies?: boolean,
  showDependents?: boolean,
  dependencyRange?: Partial<Range>,
  dependentRange?: Partial<Range>,
  selfEdges?: boolean,
}

export default class GraphVisualizationService {
  private client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  private async getParents(id: string) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')<-[r:CONTAINS*0..5]-(selectedParent) 
      RETURN selectedNode as source, r as path, selectedParent as target`;
    const records = await this.client.executeQuery<Neo4jComponentPath>(query);
    return new GraphProcessingService().formatToLPG(records, 'All parents', { selectedId: id }).graph;
  }

  private async getChildren(id: string, depth: number) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r:CONTAINS*0..${depth}]->(moduleOrLayer) 
      RETURN selectedNode as source, r as path, moduleOrLayer as target`;
    const records = await this.client.executeQuery<Neo4jComponentPath>(query);
    return new GraphProcessingService().formatToLPG(records, 'All sublayers and modules', { selectedId: id }).graph;
  }

  private async processGraphAndGetViolations(
    neo4jRecords: Record<Neo4jComponentPath>[],
    options: GraphFilterOptions = {},
  ): Promise<GraphWithViolations> {
    const {
      selectedId, maxDepth,
      dependencyRange, dependentRange, selfEdges,
    } = options;

    const {
      nodes: originalNodes,
      records: originalRecords,
    } = new GraphPreProcessingService(neo4jRecords, selectedId);
    const processor = new GraphProcessingService();

    // Find the nodes that need to be replaced (and with which nodes).
    // Also, already remove the too-deep nodes
    let replaceMap: Map<string, string> | undefined;
    if (maxDepth !== undefined) {
      replaceMap = processor.getAbstractionMap(originalRecords, maxDepth);
    }

    let records: Neo4jComponentPathWithChunks[];
    if (replaceMap && replaceMap.size > 0) {
      records = processor.applyAbstraction(originalRecords, replaceMap);
    } else {
      records = originalRecords;
    }

    // Count how many relationships each child of the selected node has
    records = processor
      .applyMinMaxRelationshipsFilter(records, true, dependencyRange?.min, dependencyRange?.max);
    records = processor
      .applyMinMaxRelationshipsFilter(records, false, dependentRange?.min, dependentRange?.max);

    const edges = processor.mergeDuplicateEdges(processor.getAllEdges(records));

    const nodes = processor.filterNodesByEdges(originalNodes, edges);

    const replaceResult = processor.replaceEdgeWithParentRelationship(nodes, edges, 'contains');

    if (selfEdges === false) {
      replaceResult.dependencyEdges = processor.filterSelfEdges(replaceResult.dependencyEdges);
    }

    const graph: Graph = {
      name: 'Dependency graph',
      nodes: replaceResult.nodes,
      edges: replaceResult.dependencyEdges,
    };

    const violations = await this.getGraphViolations(originalRecords, graph, replaceMap);

    return {
      graph,
      violations,
    };
  }

  private async getGraphViolations(
    records: Neo4jComponentPathWithChunks[],
    graph: Graph,
    replaceMap: Map<string, string> = new Map(),
  ): Promise<Violations> {
    const violationService = new GraphViolationService(this.client);

    const cyclicalDependencies = await violationService.getDependencyCycles();
    const formattedCyclDeps = violationService
      .extractAndAbstractDependencyCycles(cyclicalDependencies, graph, replaceMap);

    return {
      dependencyCycles: formattedCyclDeps,
    };
  }

  public async getGraphFromSelectedNode({
    id, layerDepth, dependencyDepth, onlyExternalRelations, onlyInternalRelations,
    showDependencies, showDependents, dependencyRange, dependentRange, selfEdges,
  }: QueryOptions): Promise<GraphWithViolations> {
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
        query += 'RETURN DISTINCT parent as source, r1 + r2 + reverse(r3) as path, selectedNode as target';
      }
      return query;
    };

    const graphs: Graph[] = await Promise.all([
      this.getParents(id),
      this.getChildren(id, layerDepth),
    ]);

    const neo4jRecords: Record<Neo4jComponentPath>[] = [];

    if (showDependencies) {
      const records = await this.client
        .executeQuery<Neo4jComponentPath>(buildQuery(true));
      neo4jRecords.push(...records);
    }
    if (showDependents) {
      const records = await this.client
        .executeQuery<Neo4jComponentPath>(buildQuery(false));
      neo4jRecords.push(...records);
    }
    const {
      graph: dependencyGraph,
      violations,
    } = await this.processGraphAndGetViolations(neo4jRecords, {
      selectedId: id,
      maxDepth: layerDepth,
      selfEdges,
      dependentRange,
      dependencyRange,
    });

    const { graph } = new GraphPostProcessingService(...graphs, dependencyGraph);

    await this.client.destroy();

    return {
      graph,
      violations,
    };
  }
}
