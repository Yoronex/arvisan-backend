import {
  Edge, IntermediateGraph, Neo4jComponentPath, Neo4jDependencyRelationship,
} from '../../entities';
import ElementParserService from './ElementParserService';
import PreProcessingService from './PreProcessingService';
import { MapSet } from '../../entities/MapSet';
import { filterDuplicates } from '../../helpers/array';
import Neo4jComponentNode from '../../entities/Neo4jComponentNode';
import { IntermediateGraphWithViolations } from '../../entities/Graph';
import ViolationService from '../violations/ViolationService';

export interface Range {
  min: number;
  max: number;
}

/**
 * @property selfEdges - If self edges should be returned
 */
export interface BasicGraphFilterOptions {
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
  /** Lifted dependency relationships within the context */
  public dependencies: MapSet<Neo4jDependencyRelationship>;

  /** The complete tree from and to the selected node */
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
    this.dependencies = MapSet.fromArray(
      (d) => d.elementId,
      records.map((r) => r.dependencyEdges).flat(),
    );
    this.selectedTreeNodes = MapSet.fromArray(
      (n) => n.elementId,
      records.map((r) => r.startNodes.concat(r.endNodes)).flat(),
    );
  }

  /**
   * Get a list of all nodes that are present in this graph
   */
  private getAllNodes(): MapSet<Neo4jComponentNode> {
    return this.filterNodesByEdges(this.original.nodes, this.dependencies)
      .concat(this.selectedTreeNodes);
  }

  /**
   * Given a list of records, return a list of all edges in the records, all having weight 1.
   * The resulting list might include duplicate edges.
   */
  private getAllEdges(): MapSet<Edge> {
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
  private applyAbstraction(records: Neo4jComponentPath[], depth: number) {
    records.forEach((record) => {
      record.liftEdges(depth);
    });
    return records;
  }

  /**
   * If two edges in the internal dependencies list have the same source and target node,
   * then they also get the same elementId.
   */
  private giveDuplicateLiftedEdgesSameElementId() {
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
  private mergeDuplicateLiftedEdges() {
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
      d.edgeProperties.dependencyTypes = d.edgeProperties.dependencyTypes
        .filter(filterDuplicates);
      return d;
    });
  }

  /**
   * Find which edges should be removed to satisfy the min/max relationship filters
   * @param outgoing
   * @param minRelationships
   * @param maxRelationships
   * @private
   */
  private findMinMaxRelationshipsFilterViolations(
    outgoing = true,
    minRelationships?: number,
    maxRelationships?: number,
  ): MapSet<Neo4jDependencyRelationship> {
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

    return this.dependencies.filter((d) => {
      const count = depCounts.get(d.startNode.elementId);
      if (!count) return false;
      if (minRelationships != null && count < minRelationships) return true;
      return maxRelationships != null && count > maxRelationships;
    });
  }

  /**
   * Apply the min/max relationship filter by removing edges that are incoming/outgoing
   * to a node that violates the minimum/maximum.
   * @param outgoingRange
   * @param incomingRange
   */
  private applyMinMaxRelationshipsFilter(
    outgoingRange?: Partial<Range>,
    incomingRange?: Partial<Range>,
  ) {
    // Find which edges to remove for the two optional ranges
    const toRemoveOutgoing = outgoingRange
      ? this.findMinMaxRelationshipsFilterViolations(true, outgoingRange?.min, outgoingRange?.max)
      : new MapSet();
    const toRemoveIncoming = incomingRange
      ? this.findMinMaxRelationshipsFilterViolations(false, incomingRange?.min, incomingRange?.max)
      : new MapSet();

    const toRemove = toRemoveOutgoing.concat(toRemoveIncoming);
    // Do not keep any edges that have to be removed according to the min/max relationships filters
    this.dependencies = this.dependencies.filter((d) => !toRemove.has(d.elementId));
  }

  /**
   * Only keep the nodes that are the start or end point of an edge
   */
  private filterNodesByEdges(
    nodes: MapSet<Neo4jComponentNode>,
    edges: MapSet<Neo4jDependencyRelationship>,
  ): MapSet<Neo4jComponentNode> {
    const nodesOnPaths: string[] = edges
      // Get the source and target from each edge (and their parents)
      .map((e): string[] => {
        const sourceParents = e.startNode.getAncestors();
        const targetParents = e.endNode.getAncestors();
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
  private filterSelfEdges(): void {
    this.dependencies = this.dependencies
      .filter((e) => e.startNode.elementId !== e.endNode.elementId);
  }

  /**
   * Parse the given Neo4j query result to a LPG
   * @param name graph name
   * @param options
   */
  public async formatToLPG(
    name: string = '',
    options: GraphFilterOptions = {},
  ): Promise<IntermediateGraphWithViolations> {
    const {
      outgoingRange, incomingRange, selfEdges,
    } = options;

    // Filter self-edges before applying any other filters
    if (selfEdges === false) {
      this.filterSelfEdges();
    }

    this.applyMinMaxRelationshipsFilter(outgoingRange, incomingRange);

    // Give two edges with the same source/target
    this.giveDuplicateLiftedEdgesSameElementId();

    const violationService = new ViolationService();
    await violationService.getGraphViolations(
      this.dependencies,
      this.original.nodes,
    );
    await violationService.destroy();

    this.mergeDuplicateLiftedEdges();

    const nodes = this.getAllNodes();
    const edges = this.getAllEdges();

    const graph: IntermediateGraph = {
      name,
      nodes,
      edges,
    };

    return {
      graph,
      violations: violationService.violations,
    };
  }
}
