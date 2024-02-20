import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import { DependencyCycle } from '../entities/violations';
import { Neo4jComponentDependency, Neo4jComponentNode } from '../database/entities';
import { ExtendedEdgeData } from '../entities/Edge';
import { LayerViolation, LayerViolationSpec } from '../entities/violations/LayerViolation';
import { DependencyCycleRender } from '../entities/violations/DependencyCycle';
import { Graph, Node } from '../entities';
import GraphElementParserService from './processing/GraphElementParserService';

interface Neo4jDependencyPath {
  path: {
    start: Neo4jComponentNode,
    end: Neo4jComponentNode,
    segments: {
      start: Neo4jComponentNode,
      relationship: Neo4jComponentDependency,
      end: Neo4jComponentNode,
    }[],
  },
}

interface Neo4jViolation {
  source: Neo4jComponentNode;
  target: Neo4jComponentNode;
}

export default class GraphViolationService {
  private readonly client: Neo4jClient;

  constructor(client?: Neo4jClient) {
    this.client = client ?? new Neo4jClient();
  }

  private formatDependencyCycles(
    records: Record<Neo4jDependencyPath>[],
  ): DependencyCycle[] {
    return records.map((r): DependencyCycle => {
      const { start, segments } = r.get('path');
      return {
        node: GraphElementParserService.formatNeo4jNodeToNodeData(start),
        path: segments.map((s): ExtendedEdgeData => ({
          ...GraphElementParserService.formatNeo4jRelationshipToEdgeData(s.relationship),
          sourceNode: GraphElementParserService.formatNeo4jNodeToNodeData(s.start),
          targetNode: GraphElementParserService.formatNeo4jNodeToNodeData(s.end),
        })),
        length: segments.length,
      };
    });
  }

  private formatLayerViolations(records: Record<Neo4jViolation>[]): LayerViolationSpec[] {
    return records.map((r): LayerViolationSpec => ({
      fromSublayer: r.get('source').properties.simpleName,
      toSublayer: r.get('target').properties.simpleName,
    }));
  }

  public async getDependencyCycles(elementIds?: string[]): Promise<DependencyCycle[]> {
    const whereClause = elementIds ? `WHERE elementId(n) IN [${elementIds.join(',')}]` : '';
    const query = `
      MATCH (n ${whereClause})
      WITH collect(n) as nodes
      CALL apoc.nodes.cycles(nodes)
      YIELD path
      RETURN path
    `;
    const records = await this.client
      .executeQuery<Neo4jDependencyPath>(query);
    return this.formatDependencyCycles(records);
  }

  /**
   * Given a list of (indirect) dependency cycles, perform the same abstraction as is
   * performed on the graph. Then, remove all cycles that are not in the graph.
   * @param dependencyCycles
   * @param graph
   * @param replaceMaps
   */
  public extractAndAbstractDependencyCycles(
    dependencyCycles: DependencyCycle[],
    graph: Graph,
    replaceMaps: Map<string, string>,
  ): DependencyCycleRender[] {
    const cycleIndex = (d1: DependencyCycle) => `${d1.node.id}--${d1.path.map((p) => p.id).join('-')}`;

    return dependencyCycles.map((dep) => {
      const newDep: DependencyCycleRender = { ...dep, actualCycles: [dep], id: cycleIndex(dep) };

      const replaceId = replaceMaps.get(dep.node.id);
      const replaceNode = graph.nodes.find((n) => n.data.id === replaceId);
      if (replaceNode) {
        newDep.node = replaceNode.data;
      }

      newDep.path = newDep.path.map((e) => {
        const newEdge: ExtendedEdgeData = { ...e };
        const replaceSource = replaceMaps.get(e.source);
        const replaceSourceNode = graph.nodes.find((n) => n.data.id === replaceSource);
        const replaceTarget = replaceMaps.get(e.target);
        const replaceTargetNode = graph.nodes.find((n) => n.data.id === replaceTarget);
        if (replaceSource && replaceSourceNode) {
          newEdge.source = replaceSource;
          newEdge.sourceNode = replaceSourceNode.data;
        }
        if (replaceTarget && replaceTargetNode) {
          newEdge.target = replaceTarget;
          newEdge.targetNode = replaceTargetNode.data;
        }
        return newEdge;
      }).map((d) => {
        // The abstracted edge exists in the graph, but possible with a different ID.
        // Therefore, we should use the same edge ID to make sure it is rendered
        // correctly in the frontend.
        const graphEdge = graph.edges
          .find((e) => e.data.source === d.source && e.data.target === d.target);
        if (graphEdge) {
          return {
            ...d,
            id: graphEdge.data.id,
          };
        }
        return d;
      }).filter((e, index) => {
        if (index === 0) return true;
        return e.source !== e.target;
      });

      return newDep;
    }).filter((d) => !!graph.nodes.find((n) => n.data.id === d.node.id))
      .map((d): DependencyCycleRender => ({ ...d, id: cycleIndex(d) }))
      .reduce((violations: DependencyCycleRender[], d) => {
        const index = violations.findIndex((d1) => d1.id === d.id);
        if (index >= 0) {
          // eslint-disable-next-line no-param-reassign
          violations[index].actualCycles = violations[index].actualCycles.concat(d.actualCycles);
        } else {
          violations.push(d);
        }
        return violations;
      }, []);
  }

  /**
   * Get a list of all (sublayer) dependency violations. These are only the "blueprints",
   * not the actual violations in a given graph.
   */
  public async getLayerViolations(): Promise<LayerViolationSpec[]> {
    const query = 'MATCH (source)-[r:VIOLATES]->(target) RETURN source, target';
    const records = await this.client.executeQuery<Neo4jViolation>(query);
    return this.formatLayerViolations(records);
  }

  /**
   * Get the given node's Sublayer parent node, if it exists.
   * It can be nonexistent if the given node is from a higher layer.
   * @param node
   * @param nodes
   * @private
   */
  private getSublayerParent(node: Node, nodes: Node[]): Node | null {
    if (!node.data.parent) return null;
    const parent = nodes.find((n) => n.data.id === node.data.parent);
    if (!parent) return null;
    if (parent.data.properties.layer.includes('Sublayer')) return parent;
    return this.getSublayerParent(parent, nodes);
  }

  private getSublayerParentFromId(nodeId: string, nodes: Node[]): Node | null {
    const node = nodes.find((n) => n.data.id === nodeId);
    if (!node) return null;
    return this.getSublayerParent(node, nodes);
  }

  /**
   * Return whether the given edge is an architectural violation
   * @param violations
   * @param sourceLayer
   * @param targetLayer
   * @private
   */
  private isLayerViolation(
    violations: LayerViolationSpec[],
    sourceLayer: Node,
    targetLayer: Node,
  ): boolean {
    const sourceLayerName = sourceLayer.data.properties.layer;
    const targetLayerName = targetLayer.data.properties.layer;
    return !!violations.find((v) => v.fromSublayer === sourceLayerName
      && v.toSublayer === targetLayerName);
  }

  public extractAndMarkLayerViolations(
    violations: LayerViolationSpec[],
    graph: Graph,
  ): Promise<LayerViolation[]> {
    const edgesWithLayers = graph.edges.map((e) => {
      const sourceLayer = this.getSublayerParentFromId(e.data.source, graph.nodes);
      const targetLayer = this.getSublayerParentFromId(e.data.target, graph.nodes);
      return {
        ...e,
        sourceLayer,
        targetLayer,
      };
    });
  }
}
