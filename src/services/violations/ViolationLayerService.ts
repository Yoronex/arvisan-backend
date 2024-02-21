import { Record } from 'neo4j-driver';
import {
  Neo4jComponentPath, Node, Neo4jComponentRelationship,
} from '../../entities';
import { LayerViolation, LayerViolationSpec } from '../../entities/violations/LayerViolation';
import GraphElementParserService from '../processing/GraphElementParserService';
import { Neo4jClient } from '../../database/Neo4jClient';
import { INeo4jComponentNode } from '../../database/entities';

interface Neo4jViolation {
  source: INeo4jComponentNode;
  target: INeo4jComponentNode;
}

export class ViolationLayerService {
  private violatingRelationships: Neo4jComponentRelationship[] = [];

  private layerViolationSpecs: LayerViolationSpec[] = [];

  constructor(private client: Neo4jClient = new Neo4jClient()) {}

  private formatLayerViolations(records: Record<Neo4jViolation>[]): LayerViolationSpec[] {
    return records.map((r): LayerViolationSpec => ({
      fromSublayer: r.get('source').properties.simpleName,
      toSublayer: r.get('target').properties.simpleName,
    }));
  }

  /**
   * Get a list of all (sublayer) dependency violations. These are only the "blueprints",
   * not the actual violations in a given graph.
   */
  private async getLayerViolationSpecs(): Promise<void> {
    const query = 'MATCH (source)-[r:VIOLATES]->(target) RETURN source, target';
    const records = await this.client.executeQuery<Neo4jViolation>(query);
    this.layerViolationSpecs = this.formatLayerViolations(records);
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
   * @param sourceLayer
   * @param targetLayer
   * @private
   */
  private isLayerViolation(
    sourceLayer: Node | undefined,
    targetLayer: Node | undefined,
  ): boolean {
    const sourceLayerName = sourceLayer?.data.properties.layer;
    const targetLayerName = targetLayer?.data.properties.layer;
    return !!this.layerViolationSpecs.find((v) => v.fromSublayer === sourceLayerName
      && v.toSublayer === targetLayerName);
  }

  public async markAndStoreLayerViolations(
    records: Neo4jComponentPath[],
  ): Promise<void> {
    await this.getLayerViolationSpecs();

    const edges = records.map((r) => r.dependencyEdges.flat()).flat();
    this.violatingRelationships = edges.filter((e) => {
      const startSublayer = e.getLayerNode(e.startNodeParents ?? [], 'Sublayer');
      const endSublayer = e.getLayerNode(e.endNodeParents ?? [], 'Sublayer');
      const isViolation = this.isLayerViolation(startSublayer, endSublayer);
      if (isViolation) {
        e.violations.subLayer = true;
      }
      return isViolation;
    });
  }

  public extractLayerViolations(): LayerViolation[] {
    return this.violatingRelationships
      .filter((r) => r.violations.subLayer)
      .map((r): LayerViolation => ({
        ...GraphElementParserService.toEdgeData(r),
        actualEdges: [GraphElementParserService.toEdgeData(r.originalRelationship)],
        sourceNode: r.startNode?.data,
        targetNode: r.endNode?.data,
      }))
      .reduce((mergedEdges: LayerViolation[], e) => {
        const index = mergedEdges
          .findIndex((e2) => e2.source === e.source
            && e2.target === e.target);
        if (index >= 0) {
          mergedEdges[index].actualEdges.push(...e.actualEdges);
        } else {
          mergedEdges.push(e);
        }
        return mergedEdges;
      }, []);
  }
}
