import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../../database/Neo4jClient';
import { DependencyCycle } from '../../entities/violations';
import { INeo4jComponentRelationship, INeo4jComponentNode } from '../../database/entities';
import { ExtendedEdgeData } from '../../entities/Edge';
import { DependencyCycleRender } from '../../entities/violations/DependencyCycle';
import { Graph } from '../../entities';
import GraphElementParserService from '../processing/GraphElementParserService';

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
}
