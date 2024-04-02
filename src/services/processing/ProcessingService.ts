import {
  Edge, IntermediateGraph, Neo4jComponentPath, Neo4jDependencyRelationship,
} from '../../entities';
import ElementParserService from './ElementParserService';
import PreProcessingService from './PreProcessingService';
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

  /**
   * If two dependencies have the same source and target edges, merge these two edges into a
   * single edge. Dependency properties are aggregated by summing numbers and concatenating lists.
   */
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

  /**
   * Apply the min/max relationship filter by removing edges that are incoming/outgoing
   * to a node that violates the minimum/maximum.
   * @param outgoing
   * @param minRelationships
   * @param maxRelationships
   */
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
