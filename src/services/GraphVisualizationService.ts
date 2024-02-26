import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import { IntermediateGraph, Neo4jComponentPath } from '../entities';
import GraphProcessingService, { GraphFilterOptions, Range } from './processing/GraphProcessingService';
import { INeo4jComponentPath } from '../database/entities';
import GraphPostProcessingService from './processing/GraphPostProcessingService';
import ViolationCyclicalDependenciesService from './violations/ViolationCyclicalDependenciesService';
import Violations from '../entities/violations';
import { IntermediateGraphWithViolations } from '../entities/Graph';
import GraphPreProcessingService from './processing/GraphPreProcessingService';
import { ViolationLayerService } from './violations';
import { ViolationBaseService } from './violations/ViolationBaseService';

export interface QueryOptions {
  id: string;
  layerDepth: number,
  dependencyDepth: number,
  onlyInternalRelations?: boolean,
  onlyExternalRelations?: boolean,
  showOutgoing?: boolean,
  showIncoming?: boolean,
  outgoingRange?: Partial<Range>,
  incomingRange?: Partial<Range>,
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
    const preprocessor = new GraphPreProcessingService(records, id);
    return new GraphProcessingService(preprocessor).formatToLPG('All parents');
  }

  private async getChildren(id: string, depth: number) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r:CONTAINS*0..${depth}]->(moduleOrLayer) 
      RETURN selectedNode as source, r as path, moduleOrLayer as target`;
    const records = await this.client.executeQuery<INeo4jComponentPath>(query);
    const preprocessor = new GraphPreProcessingService(records, id);
    return new GraphProcessingService(preprocessor).formatToLPG('All sublayers and modules');
  }

  private async processGraphAndGetViolations(
    neo4jRecords: Record<INeo4jComponentPath>[],
    selectedId?: string,
    options: GraphFilterOptions = {},
    treeGraph?: IntermediateGraph,
  ): Promise<IntermediateGraphWithViolations> {
    const {
      maxDepth,
      outgoingRange, incomingRange, selfEdges,
    } = options;

    const preprocessor = new GraphPreProcessingService(neo4jRecords, selectedId, treeGraph);
    const processor = new GraphProcessingService(preprocessor);

    if (treeGraph) {
      const containRelationships = preprocessor.records
        .map((r) => [r.containSourceEdges, r.containTargetEdges])
        .flat().flat();
      preprocessor.records.forEach((r) => {
        r.dependencyEdges.flat().forEach((dep) => {
          dep.findAndSetParents(treeGraph.nodes.concat(preprocessor.nodes), containRelationships);
        });
      });
    }

    // Find the nodes that need to be replaced (and with which nodes).
    // Also, already remove the too-deep nodes
    let replaceMap: Map<string, string> | undefined;
    if (maxDepth !== undefined) {
      replaceMap = processor.getAbstractionMap(maxDepth);
    }

    let records: Neo4jComponentPath[];
    if (replaceMap && replaceMap.size > 0) {
      records = processor.applyAbstraction(processor.original.records, replaceMap);
    } else {
      records = processor.original.records;
    }

    // Count how many relationships each child of the selected node has
    records = processor
      .applyMinMaxRelationshipsFilter(records, true, outgoingRange?.min, outgoingRange?.max);
    records = processor
      .applyMinMaxRelationshipsFilter(records, false, incomingRange?.min, incomingRange?.max);

    const edges = processor.mergeDuplicateEdges(processor.getAllEdges(records));

    const nodes = processor.filterNodesByEdges(processor.original.nodes, edges);

    const replaceResult = processor.replaceEdgeWithParentRelationship(nodes, edges, 'contains');

    if (selfEdges === false) {
      replaceResult.dependencyEdges = processor.filterSelfEdges(replaceResult.dependencyEdges);
    }

    const graph: IntermediateGraph = {
      name: 'Dependency graph',
      nodes: replaceResult.nodes,
      edges: replaceResult.dependencyEdges,
    };

    const violations = await this.getGraphViolations(
      processor.original.records,
      graph,
      replaceMap,
    );

    return {
      graph,
      violations,
    };
  }

  private async getGraphViolations(
    records: Neo4jComponentPath[],
    graph: IntermediateGraph,
    replaceMap: Map<string, string> = new Map(),
  ): Promise<Violations> {
    const violationService = new ViolationCyclicalDependenciesService(this.client);

    const cyclicalDependencies = await violationService.getDependencyCycles();
    const formattedCyclDeps = violationService
      .extractAndAbstractDependencyCycles(cyclicalDependencies, graph, replaceMap);

    const layerViolationService = new ViolationLayerService(this.client);
    await layerViolationService.markAndStoreLayerViolations(records);
    let sublayerViolations = layerViolationService.extractLayerViolations();
    sublayerViolations = sublayerViolations
      .map((v) => ViolationBaseService.replaceWithCorrectEdgeIds(v, graph));

    return {
      dependencyCycles: formattedCyclDeps,
      subLayers: sublayerViolations,
    };
  }

  public async getGraphFromSelectedNode({
    id, layerDepth, dependencyDepth, onlyExternalRelations, onlyInternalRelations,
    showOutgoing, showIncoming, outgoingRange, incomingRange, selfEdges,
  }: QueryOptions): Promise<IntermediateGraphWithViolations> {
    const buildQuery = (outgoing: boolean = true) => {
      let query = `
            MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r1:CONTAINS*0..5]->(moduleOrLayer)${!outgoing ? '<' : ''}-[r2*0..${dependencyDepth}]-${outgoing ? '>' : ''}(dependency:Module) // Get all modules that belong to the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            WHERE true `;
      if (onlyInternalRelations) {
        query += 'AND (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should be in the same domain
      }
      if (onlyExternalRelations) {
        query += 'AND NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should not be in the same domain
      }

      if (outgoing) {
        query += 'RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target';
      } else {
        query += 'RETURN DISTINCT parent as source, r1 + r2 + reverse(r3) as path, selectedNode as target';
      }
      return query;
    };

    const graphs: IntermediateGraph[] = await Promise.all([
      this.getParents(id),
      this.getChildren(id, layerDepth),
    ]);
    const { graph: treeGraph } = new GraphPostProcessingService(...graphs);

    const neo4jRecords: Record<INeo4jComponentPath>[] = [];

    if (showOutgoing) {
      const records = await this.client
        .executeQuery<INeo4jComponentPath>(buildQuery(true));
      neo4jRecords.push(...records);
    }
    if (showIncoming) {
      const records = await this.client
        .executeQuery<INeo4jComponentPath>(buildQuery(false));
      neo4jRecords.push(...records);
    }
    const {
      graph: dependencyGraph,
      violations,
    } = await this.processGraphAndGetViolations(neo4jRecords, id, {
      maxDepth: layerDepth,
      selfEdges,
      incomingRange,
      outgoingRange,
    }, treeGraph);

    const { graph } = new GraphPostProcessingService(treeGraph, dependencyGraph);

    await this.client.destroy();

    return {
      graph,
      violations,
    };
  }
}
