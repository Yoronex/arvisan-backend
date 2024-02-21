import { Neo4jComponentDependency, Neo4jComponentNode } from '../../database/entities';
import { NodeData } from '../../entities/Node';
import { EdgeData } from '../../entities/Edge';
import { Neo4jComponentDependencyWithParents } from '../../entities/Neo4jComponentDependencyWithParents';

export default class GraphElementParserService {
  /**
   * Given a Neo4j node, format it to a CytoScape NodeData object
   * @param node
   * @param selectedId
   */
  public static formatNeo4jNodeToNodeData(node: Neo4jComponentNode, selectedId?: string): NodeData {
    return {
      id: node.elementId,
      label: node.properties.simpleName,
      properties: {
        kind: node.properties.kind,
        layer: node.labels[0] || '',
        color: node.properties.color,
        depth: Number(node.properties.depth),
        selected: node.elementId === selectedId ? 'true' : 'false',
      },
    };
  }

  /**
   * Given a Neo4J relationship, format it to a CytoScape EdgeData format.
   * @param edge
   */
  public static formatNeo4jRelationshipToEdgeData(
    edge: Neo4jComponentDependency | Neo4jComponentDependencyWithParents,
  ): EdgeData {
    return {
      id: edge.elementId,
      source: edge.startNodeElementId,
      target: edge.endNodeElementId,
      interaction: edge.type.toLowerCase(),
      properties: {
        weight: 1,
        violations: {
          subLayer: 'violations' in edge ? edge.violations.subLayer : false,
        },
      },
    };
  }
}
