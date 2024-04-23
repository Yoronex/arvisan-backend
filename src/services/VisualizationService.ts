import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import ProcessingService from './processing/ProcessingService';
import { DependencyType, INeo4jComponentNode, INeo4jComponentPath } from '../database/entities';
import PostProcessingService from './processing/PostProcessingService';
import { IntermediateGraphWithViolations } from '../entities/Graph';
import PreProcessingService from './processing/PreProcessingService';
import ElementParserService from './processing/ElementParserService';

export interface BaseQueryOptions {
  /**
   * @isInt
   * @minimum 0
   */
  layerDepth: number,
}

export interface QueryOptions extends BaseQueryOptions {
  dependencyLength: number,

  /** Query relationships that are contained within the selection */
  showSelectedInternalRelations?: boolean,
  /** Query relationships that are contained within the selection's domain */
  showDomainInternalRelations?: boolean,
  /** Query relationships that are not contained within the selection's domain */
  showExternalRelations?: boolean,

  /** Whether to include applications that existing in the unclassified domain. True by default */
  includeUnclassifiedApplications?: boolean;

  /** Query outgoing relationships from the starting point */
  showOutgoing?: boolean,
  /** Query incoming relationships from the starting point */
  showIncoming?: boolean,
  outgoingRangeMin?: number,
  outgoingRangeMax?: number,
  incomingRangeMin?: number,
  incomingRangeMax?: number,
  /** Return relationships that (after lifting) depend on itself */
  selfEdges?: boolean,

  showRuntimeDependencies?: boolean;
  showCompileTimeDependencies?: boolean;
  showEntityDependencies?: boolean;
}

export default class VisualizationService {
  private readonly client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  private async getParents(id: string) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')<-[r:CONTAINS*0..5]-(selectedParent) 
      RETURN selectedNode as source, r as path, selectedParent as target`;
    const records = await this.client.executeQuery<INeo4jComponentPath>(query);
    const preprocessor = new PreProcessingService(records, id);
    return new ProcessingService(preprocessor).formatToLPG('All parents');
  }

  private async getChildren(id: string, depth: number) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r:CONTAINS*0..${depth}]->(moduleOrLayer) 
      RETURN selectedNode as source, r as path, moduleOrLayer as target`;
    const records = await this.client.executeQuery<INeo4jComponentPath>(query);
    const preprocessor = new PreProcessingService(records, id);
    return new ProcessingService(preprocessor).formatToLPG('All sublayers and modules');
  }

  public async getGraphFromSelectedNode(id: string, {
    layerDepth, dependencyLength,
    showExternalRelations, showDomainInternalRelations, showSelectedInternalRelations,
    includeUnclassifiedApplications,
    showOutgoing, showIncoming, selfEdges,
    outgoingRangeMin, outgoingRangeMax, incomingRangeMin, incomingRangeMax,
    showRuntimeDependencies, showCompileTimeDependencies, showEntityDependencies,
  }: QueryOptions): Promise<IntermediateGraphWithViolations> {
    const addParentsFilter = (query: string) => {
      if (showSelectedInternalRelations && showDomainInternalRelations
        && showExternalRelations) {
        return query;
      }

      let q = `${query}`;

      // Always return the leaf nodes of the given selection, because we need to context of the
      // selection in case only external relationships should be returned
      q += 'AND (size(r2) = 0 ';

      if (showSelectedInternalRelations && !showDomainInternalRelations) {
        q += 'OR (selectedNode)-[:CONTAINS*]->(dependency) '; // Dependency should be contained in selected node
      }
      if (showDomainInternalRelations) {
        q += 'OR (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should be in the same domain
      }
      if (showExternalRelations) {
        q += 'OR NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should not be in the same domain
      }

      q += ') ';

      return q;
    };

    const addDependencyTypeFilter = (query: string) => {
      const showAllDependencies = !!showRuntimeDependencies
        && !!showCompileTimeDependencies && !!showEntityDependencies;

      // If we want to see all dependencies, there's no reason to apply a filter
      // other than to increase execution time.
      if (showAllDependencies) return query;
      let q = `${query}`;

      const types: DependencyType[] = [];
      if (showRuntimeDependencies) types.push(DependencyType.RUNTIME);
      if (showCompileTimeDependencies) types.push(DependencyType.COMPILE_TIME);
      if (showEntityDependencies) types.push(DependencyType.ENTITY);

      // All relationships in the path should be of at least one (any) of the requested types
      const typesArray = types.map((t) => `'${t}'`).join(', ');
      q += `AND all(rel in r2 WHERE any(type in [${typesArray}] WHERE rel.dependencyTypes CONTAINS type)) `;

      return q;
    };

    const buildQuery = (outgoing: boolean = true, depLength = dependencyLength) => {
      let query = `
            // Get all modules that belong to the selected node
            MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r1:CONTAINS*0..4]->(moduleOrLayer)${!outgoing ? '<' : ''}-[r2*0..${depLength}]-${outgoing ? '>' : ''}(dependency:Module)
            // Get the domain of the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..4]-(selectedDomain:Domain)
            // Get the layers, application and domain of all dependencies
            MATCH (dependency)<-[r3:CONTAINS*0..4]-(parent)
            MATCH (parent)<-[:CONTAINS*0..4]-(parentDomain:Domain)
            WHERE true `;

      query = addParentsFilter(query);
      query = addDependencyTypeFilter(query);

      // Make sure paths are always of the same structure:
      // down from selected node, then dependencies (any direction), then down from target
      // to be able to process them the same way
      query += 'RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target';
      return query;
    };

    const graphs: IntermediateGraphWithViolations[] = await Promise.all([
      this.getParents(id),
      this.getChildren(id, layerDepth),
    ]);
    const { graph: treeGraph } = new PostProcessingService(...graphs.map((g) => g.graph));

    const promises: Promise<typeof neo4jRecords>[] = [];
    if (showOutgoing) {
      promises.push(this.client.executeQuery<INeo4jComponentPath>(buildQuery(true)));
    }
    if (showIncoming) {
      promises.push(this.client.executeQuery<INeo4jComponentPath>(buildQuery(false)));
    }
    if (!showIncoming && !showOutgoing) {
      promises.push(this.client.executeQuery<INeo4jComponentPath>(buildQuery(false, 0)));
    }
    const records = await Promise.all(promises);

    let neo4jRecords: Record<INeo4jComponentPath>[] = [];
    records.forEach((r) => { neo4jRecords = neo4jRecords.concat(r); });

    const topLevelNodes = includeUnclassifiedApplications === false ? [process.env.UNCATEGORIZED_DOMAIN_NODE_NAME ?? 'no_domain'] : [];

    const preprocessor = new PreProcessingService(neo4jRecords, id, treeGraph, topLevelNodes);
    const processor = new ProcessingService(preprocessor, layerDepth);

    const {
      graph: dependencyGraph,
      violations,
    } = await processor.formatToLPG('Dependency graph', {
      selfEdges,
      incomingRange: { min: incomingRangeMin, max: incomingRangeMax },
      outgoingRange: { min: outgoingRangeMin, max: outgoingRangeMax },
    });

    const { graph } = new PostProcessingService(dependencyGraph);

    await this.client.destroy();

    return {
      graph,
      violations,
    };
  }

  /**
   * Given a partial name, find all nodes that contain that string in their full name
   * @param partialName
   */
  public async findNode(partialName: string) {
    const query = `
      MATCH (n)-[:CONTAINS]->(m)
      WITH collect(n) AS parents, collect(m) as children
      WITH parents + children as x
      UNWIND x as b
      WITH b as a
      WHERE toLower(a.fullName) CONTAINS '${partialName.toLowerCase()}'`;
    const results = await this.client.executeQuery<{ node: INeo4jComponentNode }>(`${query} RETURN DISTINCT a as node LIMIT 100`);
    const countRecord = await this.client.executeQuery<{ count: number }>(`${query} RETURN count(DISTINCT a) as count`);

    const records = results.map((r) => ({ data: ElementParserService.toNodeData(r.get('node')) }));
    return {
      records,
      count: countRecord[0].get('count'),
    };
  }
}
