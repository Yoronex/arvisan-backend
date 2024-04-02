import {
  Edge, IntermediateGraph, Neo4jComponentPath, Neo4jDependencyRelationship,
} from '../../entities';
import { INeo4jComponentRelationship } from '../../database/entities';
import ElementParserService from './ElementParserService';
import PreProcessingService from './PreProcessingService';
import { Neo4jDependencyType } from '../../entities/Neo4jComponentPath';

import { MapSet } from '../../entities/MapSet';
import { filterDuplicates } from '../../helpers/array';
import Neo4jComponentNode from '../../entities/Neo4jComponentNode';

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
  public dependencies: MapSet<Neo4jDependencyRelationship>;

  public selectedTreeNodes: MapSet<Neo4jComponentNode> = new MapSet<Neo4jComponentNode>();

  constructor(
    public readonly original: PreProcessingService,
    maxDepth?: number,
  ) {
    let records;
    if (maxDepth !== undefined) {
      records = this.applyAbstraction(original.records, maxDepth);
    } else {
      records = original.records;
    }

    // Store individual dependency relationships. Each edge has their parents and a unique ID.
    // Automatically filters duplicate edges that lie on different paths (by design)
    this.dependencies = MapSet.from(...records.map((r) => r.dependencyEdges).flat());
    this.selectedTreeNodes = MapSet.from(
      ...records.map((r) => r.startNodes.concat(r.endNodes)).flat(),
    );
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
   */
  getAllEdges(): MapSet<Edge> {
    const edges = new MapSet<Edge>();
    this.dependencies.forEach((dependency) => {
      const edgeId = dependency.elementId;
      if (edges.has(edgeId)) return;
      edges.set(edgeId, {
        data: ElementParserService.toEdgeData(dependency),
      });
    });
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
      if (!existingEdge) return newEdges.set(edge.data.id, edge);

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
   * @param depth
   */
  applyAbstraction(records: Neo4jComponentPath[], depth: number) {
    records.forEach((record) => {
      record.liftEdges(depth);
    });
    return records;
  }

  /**
   * If two edges in the internal dependencies list have the same source and target node,
   * then they also get the same elementId.
   */
  giveDuplicateLiftedEdgesSameElementId() {
    const seenEdges = new Map<string, string>();
    this.dependencies.forEach((d) => {
      const fromTo = [d.startNode.elementId, d.endNode.elementId].join(' -> ');
      const existingId = seenEdges.get(fromTo);
      if (!existingId) {
        seenEdges.set(fromTo, d.elementId);
      } else {
        // eslint-disable-next-line no-param-reassign
        d.elementId = existingId;
      }
    });
  }

  mergeDuplicateLiftedEdges() {
    this.dependencies = this.dependencies.reduce((result, r) => {
      const existing = result.find((r2) => r.startNode.elementId === r2.startNode.elementId
        && r.endNode.elementId === r2.endNode.elementId);
      if (!existing) {
        result.set(r.elementId, r);
      } else {
        existing.mergeProperties(r.edgeProperties);
      }
      return result;
    }, new MapSet<Neo4jDependencyRelationship>());
    this.dependencies.forEach((d) => {
      // eslint-disable-next-line no-param-reassign
      d.edgeProperties.referenceKeys = d.edgeProperties.referenceKeys.filter(filterDuplicates);
      // eslint-disable-next-line no-param-reassign
      d.edgeProperties.referenceTypes = d.edgeProperties.referenceTypes.filter(filterDuplicates);
      // eslint-disable-next-line no-param-reassign
      d.edgeProperties.referenceNames = d.edgeProperties.referenceNames.filter(filterDuplicates);
      // eslint-disable-next-line no-param-reassign
      d.edgeProperties.dependencyTypes = d.edgeProperties.dependencyTypes
        .filter(filterDuplicates);
      return d;
    });
  }

  applyMinMaxRelationshipsFilter(
    outgoing = true,
    minRelationships?: number,
    maxRelationships?: number,
  ) {
    let depCounts: Map<string, number>;
    if (outgoing) {
      const outgoingDeps = this.dependencies.filter((d) => d.startNode.inSelection);
      depCounts = outgoingDeps.reduce((counts, dependency) => {
        const key = dependency.startNode.elementId;
        const existingCount = counts.get(key);
        if (!existingCount) {
          counts.set(key, 1);
        } else {
          counts.set(key, existingCount + 1);
        }
        return counts;
      }, new Map<string, number>());
    } else {
      const incomingDeps = this.dependencies.filter((d) => d.endNode.inSelection);
      depCounts = incomingDeps.reduce((counts, dependency) => {
        const key = dependency.endNode.elementId;
        const existingCount = counts.get(key);
        if (!existingCount) {
          counts.set(key, 1);
        } else {
          counts.set(key, existingCount + 1);
        }
        return counts;
      }, new Map<string, number>());
    }

    this.dependencies = this.dependencies.filter((d) => {
      const count = depCounts.get(d.startNode.elementId);
      if (!count) return true;
      if (minRelationships != null && count < minRelationships) return false;
      if (maxRelationships != null && count > maxRelationships) return false;
      return true;
    });
  }

  /**
   * Apply a filtering based on the amount of incoming and outgoing relationships
   * @param records
   * @param outgoing Count outgoing relationships, i.e. dependencies
   * @param minRelationships
   * @param maxRelationships
   */
  applyMinMaxRelationshipsFilterOld(
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
  filterNodesByEdges(
    nodes: MapSet<Neo4jComponentNode>,
    edges: MapSet<Neo4jDependencyRelationship>,
  ): MapSet<Neo4jComponentNode> {
    const nodesOnPaths: string[] = edges
      // Get the source and target from each edge (and their parents)
      .map((e): string[] => {
        const sourceParents = e.startNode.getParents();
        const targetParents = e.endNode.getParents();
        return sourceParents.concat(targetParents).map((n) => n.elementId);
      })
      // Flatten the 2D array
      .flat()
      // Remove duplicates
      .filter(filterDuplicates);
    // Filter the actual node objects
    return nodes.filterByKeys(nodesOnPaths);
  }

  /**
   * Remove all self-edges (edges where the source and target is the same node) in-place
   */
  filterSelfEdges(): void {
    this.dependencies = this.dependencies
      .filter((e) => e.startNode.elementId !== e.endNode.elementId);
  }

  /**
   *
   */
  replaceEdgeWithParentRelationship(
    nodes: MapSet<Neo4jComponentNode>,
    edges: MapSet<Edge>,
    relationship: string,
  ): { nodes: MapSet<Neo4jComponentNode>, dependencyEdges: MapSet<Edge> } {
    // Split the list of edges into "contain" edges and all other edges
    // const containEdges = edges.filter((e) => e.data.interaction === relationship);
    const dependencyEdges = edges.filter((e) => e.data.interaction !== relationship);

    return { nodes, dependencyEdges };
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
    const { selfEdges } = options;

    this.mergeDuplicateLiftedEdges();

    const nodes = this
      .filterNodesByEdges(this.original.nodes, this.dependencies)
      .concat(this.selectedTreeNodes);

    if (selfEdges === false) {
      this.filterSelfEdges();
    }

    const edges = this.getAllEdges();

    return {
      name,
      nodes,
      edges,
    };
  }
}
