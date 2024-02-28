import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../../database/Neo4jClient';
import { DependencyCycle } from '../../entities/violations';
import { INeo4jComponentRelationship, INeo4jComponentNode } from '../../database/entities';
import { ExtendedEdgeData } from '../../entities/Edge';
import { DependencyCycleRender } from '../../entities/violations/DependencyCycle';
import { IntermediateGraph, Neo4jComponentPath } from '../../entities';
import ElementParserService from '../processing/ElementParserService';
import { ViolationBaseService } from './ViolationBaseService';

interface Neo4jDependencyPath {
  path: {
    start: INeo4jComponentNode,
    end: INeo4jComponentNode,
    segments: {
      start: INeo4jComponentNode,
      relationship: INeo4jComponentRelationship,
      end: INeo4jComponentNode,
    }[],
  },
}

export default class ViolationCyclicalDependenciesService {
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
        node: ElementParserService.toNodeData(start),
        path: segments.map((s): ExtendedEdgeData => ({
          ...ElementParserService.toEdgeData(s.relationship),
          sourceNode: ElementParserService.toNodeData(s.start),
          targetNode: ElementParserService.toNodeData(s.end),
        })),
        length: segments.length,
      };
    });
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
   * @param records
   * @param graph
   * @param replaceMaps
   */
  public extractAndAbstractDependencyCycles(
    dependencyCycles: DependencyCycle[],
    records: Neo4jComponentPath[],
    graph: IntermediateGraph,
    replaceMaps: Map<string, string>,
  ): DependencyCycleRender[] {
    const cycleIndex = (d1: DependencyCycle) => `${d1.node.id}--${d1.path.map((p) => p.id).join('-')}`;
    const existingEdges = records.map((r) => r.dependencyEdges).flat();

    return dependencyCycles.map((dep) => {
      const newDep: DependencyCycleRender = { ...dep, actualCycles: [dep], id: cycleIndex(dep) };
      const newPath = dep.path.map((d): ExtendedEdgeData => {
        const existingEdge = existingEdges
          .find((r) => r.originalStartNode.data.id === d.source
            && r.originalEndNode.data.id === d.target);

        // Edge exists within the rendered graph
        if (existingEdge) {
          existingEdge.violations.dependencyCycle = true;
          return {
            ...d,
            source: existingEdge.startNodeElementId,
            sourceNode: existingEdge.startNode?.data ?? existingEdge.originalStartNode.data,
            target: existingEdge.endNodeElementId,
            targetNode: existingEdge.endNode?.data ?? existingEdge.originalEndNode.data,
          };
        }

        // Edge not found, so we have to find the source and target nodes
        // manually (if they even exist)
        const newD = { ...d };

        const newSourceId = replaceMaps.get(d.source);
        const sourceNode = graph.nodes.find((n) => n.data.id === newSourceId);
        if (sourceNode) {
          newD.source = sourceNode.data.id;
          newD.sourceNode = sourceNode.data;
        }
        const newTargetId = replaceMaps.get(d.target);
        const targetNode = graph.nodes.find((n) => n.data.id === newTargetId);
        if (targetNode) {
          newD.target = targetNode.data.id;
          newD.targetNode = targetNode.data;
        }
        return newD;
      });

      newDep.path = newPath
        .map((d) => ViolationBaseService.replaceWithCorrectEdgeIds(d, graph))
        // Keep at most only one self edge if the cyclical dependency is fully contained.
        // If not, remove any self edges from the chain
        .filter((e, index, all) => {
          if (index === 0 && all.every((e2) => e2.source === e2.target)) return true;
          return e.source !== e.target;
        });
      newDep.node = newPath[0].sourceNode;

      return newDep;
      // Keep only dependency cycles that have their source node in the current graph
    }).filter((d) => !!graph.nodes.find((n) => n.data.id === d.node.id))
      // Generate a new ID for each dependency cycle
      .map((d): DependencyCycleRender => ({ ...d, id: cycleIndex(d) }))
      // Merge all dependency cycles with the same ID
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
}
