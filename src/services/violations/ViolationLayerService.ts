import { Record } from 'neo4j-driver';
import {
  Neo4jComponentPath, Neo4jDependencyRelationship,
} from '../../entities';
import { LayerViolation, LayerViolationSpec } from '../../entities/violations/LayerViolation';
import ElementParserService from '../processing/ElementParserService';
import { Neo4jClient } from '../../database/Neo4jClient';
import { INeo4jComponentNode } from '../../database/entities';
import Neo4jComponentNode from '../../entities/Neo4jComponentNode';

interface Neo4jViolation {
  source: INeo4jComponentNode;
  target: INeo4jComponentNode;
}

export class ViolationLayerService {
  private violatingRelationships: Neo4jDependencyRelationship[] = [];

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
   * Return whether the given edge is an architectural violation
   * @param sourceLayer
   * @param targetLayer
   * @private
   */
  private isLayerViolation(
    sourceLayer: Neo4jComponentNode | undefined,
    targetLayer: Neo4jComponentNode | undefined,
  ): boolean {
    const sourceLayerName = sourceLayer?.layer;
    const targetLayerName = targetLayer?.layer;
    // Current dependency not in the list of violations, so its not a violation
    if (!this.layerViolationSpecs.find((v) => v.fromSublayer === sourceLayerName
      && v.toSublayer === targetLayerName)) return false;
    if (!sourceLayer || !targetLayer) return false;

    const sourceParents = sourceLayer.getParents();
    const sourceTop = sourceParents[sourceParents.length - 1];
    const targetParents = targetLayer.getParents();
    const targetTop = targetParents[targetParents.length - 1];
    // Layer violations need to be in the same domain (top level node)
    return sourceTop.elementId === targetTop.elementId;
  }

  public async markAndStoreLayerViolations(
    records: Neo4jComponentPath[],
  ): Promise<void> {
    await this.getLayerViolationSpecs();

    const edges = records.map((r) => r.dependencyEdges.flat()).flat();
    this.violatingRelationships = edges.filter((e) => {
      const startSublayer = e.originalStartNode.getLayerNode('Sublayer');
      const endSublayer = e.originalEndNode.getLayerNode('Sublayer');
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
        ...ElementParserService.toEdgeData(r),
        actualEdges: [{
          ...ElementParserService.toEdgeData(r.originalRelationship),
          sourceNode: ElementParserService.toNodeData(r.originalStartNode),
          targetNode: ElementParserService.toNodeData(r.originalEndNode),
        }],
        sourceNode: ElementParserService.toNodeData(r.startNode),
        targetNode: ElementParserService.toNodeData(r.endNode),
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
