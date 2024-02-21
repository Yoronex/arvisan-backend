import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import { Graph, Neo4jComponentPath } from '../entities';
import GraphProcessingService, { GraphFilterOptions, Range } from './processing/GraphProcessingService';
import { INeo4jComponentPath } from '../database/entities';
import GraphPostProcessingService from './processing/GraphPostProcessingService';
import ViolationCyclicalDependenciesService from './violations/ViolationCyclicalDependenciesService';
import Violations from '../entities/violations';
import { GraphWithViolations } from '../entities/Graph';
import GraphPreProcessingService from './processing/GraphPreProcessingService';
import { ViolationLayerService } from './violations';

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
  private readonly client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  private async getParents(id: string) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')<-[r:CONTAINS*0..5]-(selectedParent) 
      RETURN selectedNode as source, r as path, selectedParent as target`;
    const records = await this.client.executeQuery<INeo4jComponentPath>(query);
    return new GraphProcessingService().formatToLPG(records, 'All parents', { selectedId: id });
  }

  private async getChildren(id: string, depth: number) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r:CONTAINS*0..${depth}]->(moduleOrLayer) 
      RETURN selectedNode as source, r as path, moduleOrLayer as target`;
    const records = await this.client.executeQuery<INeo4jComponentPath>(query);
    return new GraphProcessingService().formatToLPG(records, 'All sublayers and modules', { selectedId: id });
  }

  private async processGraphAndGetViolations(
    neo4jRecords: Record<INeo4jComponentPath>[],
    options: GraphFilterOptions = {},
    treeGraph?: Graph,
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

    if (treeGraph) {
      const containRelationships = originalRecords
        .map((r) => [r.containSourceEdges, r.containTargetEdges])
        .flat().flat();
      originalRecords.forEach((r) => {
        r.dependencyEdges.flat().forEach((dep) => {
          dep.findAndSetParents([...treeGraph.nodes, ...originalNodes], containRelationships);
        });
      });
    }

    // Find the nodes that need to be replaced (and with which nodes).
    // Also, already remove the too-deep nodes
    let replaceMap: Map<string, string> | undefined;
    if (maxDepth !== undefined) {
      replaceMap = processor.getAbstractionMap(originalRecords, maxDepth);
    }

    let records: Neo4jComponentPath[];
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
    records: Neo4jComponentPath[],
    graph: Graph,
    replaceMap: Map<string, string> = new Map(),
  ): Promise<Violations> {
    const violationService = new ViolationCyclicalDependenciesService(this.client);

    const cyclicalDependencies = await violationService.getDependencyCycles();
    const formattedCyclDeps = violationService
      .extractAndAbstractDependencyCycles(cyclicalDependencies, graph, replaceMap);

    const layerViolationService = new ViolationLayerService(this.client);
    await layerViolationService.markAndStoreLayerViolations(records);

    return {
      dependencyCycles: formattedCyclDeps,
      subLayers: layerViolationService.extractLayerViolations(),
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
    const { graph: treeGraph } = new GraphPostProcessingService(...graphs);

    const neo4jRecords: Record<INeo4jComponentPath>[] = [];

    if (showDependencies) {
      const records = await this.client
        .executeQuery<INeo4jComponentPath>(buildQuery(true));
      neo4jRecords.push(...records);
    }
    if (showDependents) {
      const records = await this.client
        .executeQuery<INeo4jComponentPath>(buildQuery(false));
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
    }, treeGraph);

    const { graph } = new GraphPostProcessingService(treeGraph, dependencyGraph);

    await this.client.destroy();

    return {
      graph,
      violations,
    };
  }
}
