import {
  INeo4jComponentNode,
  INeo4jComponentRelationship,
  ModuleDependencyProfileCategory,
} from '../../database/entities';
import { NodeData } from '../../entities/Node';
import { EdgeData } from '../../entities/Edge';
import { Neo4jComponentRelationship, Graph, IntermediateGraph } from '../../entities';
import Neo4jComponentNode from '../../entities/Neo4jComponentNode';

export default class ElementParserService {
  /**
   * Get the longest label (which is probably the one you want)
   * @param labels
   */
  public static getLongestLabel(labels: string[]): string {
    return labels.sort((a, b) => b.length - a.length)[0] ?? '???';
  }

  /**
   * Get the longest label (which is probably the one you want)
   * @param labels
   */
  public static getShortestLabel(labels: string[]): string {
    return labels.sort((a, b) => a.length - b.length)[0] ?? '???';
  }

  /**
   * Given a list of labels, parse it to its core "label" and a list
   * of possible classes within that layer
   * @param labels
   * @returns tuple with [label, classes]
   */
  public static extractLayer(labels: string[]): [string, string[]] {
    const labelIndex = labels.findIndex((l) => !l.includes('_'));
    const label = labels[labelIndex];

    const classes = [...labels];
    classes.splice(labelIndex, 1);
    const classNames = classes.map((c) => c.split('_')[1]);

    return [label, classNames];
  }

  public static toDependencyProfile(
    category?: ModuleDependencyProfileCategory,
  ): [number, number, number, number] {
    switch (category) {
      case ModuleDependencyProfileCategory.HIDDEN: return [1, 0, 0, 0];
      case ModuleDependencyProfileCategory.INBOUND: return [0, 1, 0, 0];
      case ModuleDependencyProfileCategory.OUTBOUND: return [0, 0, 1, 0];
      case ModuleDependencyProfileCategory.TRANSIT: return [0, 0, 0, 1];
      default: return [0, 0, 0, 0];
    }
  }

  /**
   * Given a Neo4j node, format it to a CytoScape NodeData object
   * @param node
   * @param selectedId
   */
  public static toNodeData(
    node: INeo4jComponentNode | Neo4jComponentNode,
    selectedId?: string,
  ): NodeData {
    return {
      id: node.elementId,
      label: node.properties.simpleName,
      parent: 'parent' in node ? node.parent?.elementId : undefined,
      properties: {
        fullName: node.properties.fullName,
        layer: this.getLongestLabel(node.labels),
        color: node.properties.color,
        depth: Number(node.properties.depth),
        selected: ('selected' in node && node.selected) || node.elementId === selectedId ? 'true' : 'false',
        dependencyProfileCategory: node.properties.dependencyProfileCategory,
        dependencyProfile: 'dependencyProfile' in node ? node.dependencyProfile : this.toDependencyProfile(node.properties.dependencyProfileCategory),
        fileSizeKB: node.properties.fileSizeKB,
        nrScreens: node.properties.nrScreens,
        nrEntities: node.properties.nrEntities,
        nrPublicElements: node.properties.nrPublicElements,
        nrRESTConsumers: node.properties.nrRESTConsumers,
        nrRESTProducers: node.properties.nrRESTProducers,
        nrLeaves: 'getLeafChildren' in node ? node.getLeafChildren().length : undefined,
      },
    };
  }

  /**
   * Given a Neo4J relationship, format it to a CytoScape EdgeData format.
   * @param edge
   */
  public static toEdgeData(
    edge: INeo4jComponentRelationship | Neo4jComponentRelationship,
  ): EdgeData {
    return {
      id: edge.elementId,
      source: edge.startNodeElementId,
      target: edge.endNodeElementId,
      interaction: edge.type.toLowerCase(),
      properties: {
        referenceKeys: [],
        violations: {
          subLayer: 'violations' in edge ? edge.violations.subLayer : false,
          dependencyCycle: 'violations' in edge ? edge.violations.dependencyCycle : false,
          any: 'violations' in edge ? edge.violations.subLayer || edge.violations.dependencyCycle : false,
        },
        referenceTypes: [edge.properties.referenceType],
        referenceNames: edge.properties.referenceNames?.split('|') ?? [],
        dependencyTypes: edge.properties.dependencyType
          ? [edge.properties.dependencyType] : [],
        nrModuleDependencies: 1,
        nrFunctionDependencies: Number(edge.properties.nrDependencies) || 1,
        weight: Number(edge.properties.nrDependencies) || 1,
        nrCalls: Number(edge.properties.nrCalls) || undefined,
      },
    };
  }

  public static toGraph(intermediateGraph: IntermediateGraph): Graph {
    return {
      name: intermediateGraph.name,
      nodes: [...intermediateGraph.nodes
        .map((n) => ({ data: ElementParserService.toNodeData(n) }))],
      edges: [...intermediateGraph.edges.values()],
    };
  }
}
