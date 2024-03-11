import {
  Edge, Graph, IntermediateGraph, Neo4jComponentPath, Node,
} from '../../entities';
import { INeo4jComponentRelationship } from '../../database/entities';
import ElementParserService from './ElementParserService';
import PreProcessingService from './PreProcessingService';
import { Neo4jDependencyType } from '../../entities/Neo4jComponentPath';

import { MapSet } from '../../entities/MapSet';
import { filterDuplicates } from '../../helpers/array';

export interface Range {
  min: number;
  max: number;
}

/**
 * @property selectedId - ID of the selected node to highlight it
 * @property maxDepth - How deep the "CONTAIN" edges on the target side should go.
 * If there is a path between two nodes too deep, create a transitive edge
 * @property selfEdges - If self edges should be returned
 */
export interface BasicGraphFilterOptions {
  maxDepth?: number;
  selfEdges?: boolean;
}

/**
 * @property outgoingRange - How many outgoing arrows a node is allowed to have
 * @property incomingRange - How many incoming arrows a node is allowed to have
 */
export interface GraphFilterOptions extends BasicGraphFilterOptions {
  outgoingRange?: Partial<Range>;
  incomingRange?: Partial<Range>;
}

export default class ProcessingService {
  public readonly original: PreProcessingService;

  constructor(
    preprocessor: PreProcessingService,
    public readonly contextGraph: Graph = { edges: [], nodes: [], name: 'undefined' },
  ) {
    this.original = preprocessor;
  }

  /**
   * Given a complete Neo4j graph query result, create a mapping from module IDs
   * to their abstractions
   * @param maxDepth
   */
  getAbstractionMap(
    maxDepth: number,
  ): Map<string, string> {
    // Replace all transitive nodes with this existing end node (the first of the full path)
    const replaceMap = new Map<string, string>();
    const addToReplaceMap = (deletedEdges: INeo4jComponentRelationship[]) => {
      if (deletedEdges.length === 0) return;
      const firstStartNode = deletedEdges[0].startNodeElementId;
      deletedEdges.forEach((edge) => replaceMap
        .set(edge.endNodeElementId, firstStartNode));
    };

    this.original.records.forEach((record) => {
      const containsSourceDepth = record.sourceDepth;
      const containsTargetDepth = record.targetDepth;
      const containsTooDeep = Math.max(0, containsSourceDepth - maxDepth);

      const deletedSource = record.containSourceEdges.splice(maxDepth, containsTooDeep);
      addToReplaceMap(deletedSource);

      const deletedTarget = record.containTargetEdges
        .splice(containsTargetDepth - containsTooDeep, containsTooDeep);
      addToReplaceMap(deletedTarget);
    });

    return replaceMap;
  }

  /**
   * Given a list of records, return a list of all edges in the records, all having weight 1.
   * The resulting list might include duplicate edges.
   * @param records
   */
  getAllEdges(records: Neo4jComponentPath[]): MapSet<Edge> {
    const edges = new MapSet<Edge>();
    records.forEach((record) => record.allEdges.forEach((r) => {
      const edgeId = r.elementId;
      if (edges.has(edgeId)) return;
      edges.set(edgeId, {
        data: ElementParserService.toEdgeData(r),
      });
    }));
    return edges;
  }

  /**
   * Given a list of edges, merge two edges with the same source and target node.
   * The merged edge's weight will be the sum of both edge weights.
   * @param edges
   */
  mergeDuplicateEdges(edges: MapSet<Edge>): MapSet<Edge> {
    const newEdges2 = edges.reduce((newEdges: MapSet<Edge>, edge) => {
      const existingEdge = newEdges.find((e) => e.data.source === edge.data.source
        && e.data.target === edge.data.target);
      if (!existingEdge) return newEdges.add(edge);

      existingEdge.data.properties.weight += edge.data.properties.weight;
      existingEdge.data.properties.nrModuleDependencies += edge
        .data.properties.nrModuleDependencies;
      existingEdge.data.properties.nrFunctionDependencies += edge
        .data.properties.nrFunctionDependencies;

      existingEdge.data.properties.dependencyTypes = existingEdge.data.properties.dependencyTypes
        .concat(...edge.data.properties.dependencyTypes);
      existingEdge.data.properties.referenceKeys = existingEdge.data.properties.referenceKeys
        .concat(...edge.data.properties.referenceKeys);
      existingEdge.data.properties.referenceTypes = existingEdge.data.properties.referenceTypes
        .concat(edge.data.properties.referenceTypes);
      existingEdge.data.properties.referenceNames = existingEdge.data.properties.referenceNames
        .concat(...edge.data.properties.referenceNames);

      return newEdges;
    }, new MapSet<Edge>());

    newEdges2.forEach((e) => {
      e.data.properties.dependencyTypes = e.data.properties.dependencyTypes
        .filter(filterDuplicates);
      e.data.properties.referenceKeys = e.data.properties.referenceKeys.filter(filterDuplicates);
      e.data.properties.referenceTypes = e.data.properties.referenceTypes.filter(filterDuplicates);
      e.data.properties.referenceNames = e.data.properties.referenceNames.filter(filterDuplicates);
    });

    return newEdges2;
  }

  /**
   * Apply an abstraction based on the grouping (clustering) of the nodes
   * @param records List of paths
   * @param abstractionMap Mapping with which node ids should be abstracted to which node ids
   */
  applyAbstraction(records: Neo4jComponentPath[], abstractionMap: Map<string, string>) {
    return records.map((record): Neo4jComponentPath => {
      // eslint-disable-next-line no-param-reassign
      record.dependencyEdges = record.dependencyEdges.map((e) => {
        if (abstractionMap.has(e.startNodeElementId)) {
          e.startNodeElementId = abstractionMap.get(e.startNodeElementId) as string;
        }
        if (abstractionMap.has(e.endNodeElementId)) {
          e.endNodeElementId = abstractionMap.get(e.endNodeElementId) as string;
        }
        e.setNodeReferences(MapSet.from(...this.contextGraph.nodes).concat(this.original.nodes));
        return e;
      });
      return record;
    });
  }

  /**
   * Apply a filtering based on the amount of incoming and outgoing relationships
   * @param records
   * @param outgoing Count outgoing relationships, i.e. dependencies
   * @param minRelationships
   * @param maxRelationships
   */
  applyMinMaxRelationshipsFilter(
    records: Neo4jComponentPath[],
    outgoing = true,
    minRelationships?: number,
    maxRelationships?: number,
  ) {
    // Count how many relationships each child of the selected node has
    const relationsMap = new Map<string, string[]>();
    records.forEach((record) => {
      if (minRelationships == null && maxRelationships == null) return;

      // eslint-disable-next-line prefer-destructuring
      const edge = record.dependencyEdges.flat()[0]; // Last element of first chunk
      const isDependency = record.type === Neo4jDependencyType.OUTGOING;
      let node: string;
      let relatedNode: string;
      if ((outgoing && isDependency) || (!outgoing && !isDependency)) {
        node = edge?.startNodeElementId;
        relatedNode = edge?.endNodeElementId;
      } else {
        node = edge?.endNodeElementId;
        relatedNode = edge?.startNodeElementId;
      }

      if (!relatedNode) return;

      if (!relationsMap.get(node)?.includes(relatedNode)) {
        const currentRelations = relationsMap.get(node) || [];
        relationsMap.set(node, [...currentRelations, relatedNode]);
      }
    });

    // Apply filter
    return records.filter((record) => {
      if (minRelationships == null && maxRelationships == null) return true;

      const node = record.selectedModuleElementId;

      const uniqueRelationships = relationsMap.get(node) || [];
      if (minRelationships != null && uniqueRelationships.length < minRelationships) return false;
      if (maxRelationships != null && uniqueRelationships.length > maxRelationships) return false;
      return true;
    });
  }

  /**
   * Only keep the nodes that are the start or end point of an edge
   */
  filterNodesByEdges(nodes: MapSet<Node>, edges: MapSet<Edge>): MapSet<Node> {
    const nodesOnPaths: string[] = edges
      // Get the source and target from each edge
      .map((e): string[] => [e.data.source, e.data.target])
      // Flatten the 2D array
      .flat()
      // Remove duplicates
      .filter(filterDuplicates);
    // Filter the actual node objects
    return nodes.filterByKeys(nodesOnPaths);
  }

  /**
   * Remove all self-edges (edges where the source and target is the same node)
   */
  filterSelfEdges(edges: MapSet<Edge>): MapSet<Edge> {
    return edges.filter((e) => e.data.source !== e.data.target);
  }

  /**
   * Replace every given edge with a parent relationship, which is supported by Cytoscape.
   */
  addParentRelationship(nodes: MapSet<Node>, parentEdges: MapSet<Edge>): MapSet<Node> {
    const nodesCopy: MapSet<Node> = new MapSet(nodes);
    parentEdges.forEach((e) => {
      const target = nodesCopy.get(e.data.target);
      if (!target) return;
      target.data.parent = e.data.source;
    });
    return nodesCopy;
  }

  /**
   *
   */
  replaceEdgeWithParentRelationship(
    nodes: MapSet<Node>,
    edges: MapSet<Edge>,
    relationship: string,
  ): { nodes: MapSet<Node>, dependencyEdges: MapSet<Edge> } {
    // Split the list of edges into "contain" edges and all other edges
    const containEdges = edges.filter((e) => e.data.interaction === relationship);
    const dependencyEdges = edges.filter((e) => e.data.interaction !== relationship);

    // Replace every "contain" edge with a parent relationship, which is supported by Cytoscape.
    const newNodes = this.addParentRelationship(nodes, containEdges);

    return { nodes: newNodes, dependencyEdges };
  }

  /**
   * Parse the given Neo4j query result to a LPG
   * @param name graph name
   * @param options
   */
  formatToLPG(
    name: string,
    options: BasicGraphFilterOptions = {},
  ): IntermediateGraph {
    const {
      maxDepth, selfEdges,
    } = options;

    let filteredRecords = this.original.records;

    // Find the nodes that need to be replaced (and with which nodes).
    // Also, already remove the too-deep nodes
    let replaceMap: Map<string, string> | undefined;
    if (maxDepth !== undefined) {
      replaceMap = this.getAbstractionMap(maxDepth);
      filteredRecords = this.applyAbstraction(filteredRecords, replaceMap);
    }

    let edges = this.getAllEdges(filteredRecords);
    edges = this.mergeDuplicateEdges(edges);

    const nodes = this.filterNodesByEdges(this.original.nodes, edges);

    const replaceResult = this.replaceEdgeWithParentRelationship(nodes, edges, 'contains');

    if (selfEdges === false) {
      replaceResult.dependencyEdges = this.filterSelfEdges(replaceResult.dependencyEdges);
    }

    return {
      name,
      nodes: replaceResult.nodes,
      edges: replaceResult.dependencyEdges,
    };
  }
}
