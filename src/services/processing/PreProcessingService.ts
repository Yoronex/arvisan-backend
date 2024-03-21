import { Record } from 'neo4j-driver';
import {
  Edge, IntermediateGraph, Neo4jComponentPath, Node,
} from '../../entities';
import { INeo4jComponentPath, Neo4jRelationshipMappings } from '../../database/entities';
import ElementParserService from './ElementParserService';
import { MapSet } from '../../entities/MapSet';
import { filterDuplicates } from '../../helpers/array';

export default class PreProcessingService {
  public readonly nodes: MapSet<Node>;

  public readonly selectedNode?: Node;

  public readonly records: Neo4jComponentPath[];

  /**
   * @param records Unprocessed Neo4j paths
   * @param selectedId ID of the selected node (to highlight it)
   * @param context Optional graph that can provide more context to the given records,
   * i.e. when nodes or edges are missing from the given records.
   * @param selectedDomain Whether the starting point of the selection is one or more domains.
   * Overridden by selectedId, if it exists.
   */
  constructor(
    records: Record<INeo4jComponentPath>[],
    public readonly selectedId?: string,
    public readonly context?: IntermediateGraph,
    selectedDomain: boolean = true,
  ) {
    const allContainRelationships: Neo4jRelationshipMappings = {
      sourceToTargets: new Map(),
      targetToSource: new Map(),
    };

    // Create a mapping from source to targets and target to source to efficiently
    // find a node's parents later
    records.forEach((record) => record.get('path')
      .forEach((rel) => {
        if (rel.type !== 'CONTAINS') return;
        allContainRelationships.targetToSource.set(rel.endNodeElementId, rel.startNodeElementId);
        if (allContainRelationships.sourceToTargets.has(rel.startNodeElementId)) {
          const targets = allContainRelationships.sourceToTargets.get(rel.startNodeElementId);
          targets?.push(rel.endNodeElementId);
        } else {
          allContainRelationships.sourceToTargets
            .set(rel.startNodeElementId, [rel.endNodeElementId]);
        }
      }));

    this.nodes = this.getAllNodes(records, allContainRelationships, selectedId);
    this.selectedNode = this.nodes.get(selectedId);

    const chunkRecords = this.splitRelationshipsIntoChunks(
      records,
      allContainRelationships,
      this.selectedNode ? this.selectedNode.data.properties.layer === 'Domain' : selectedDomain,
    );
    this.records = this.onlyKeepLongestPaths(chunkRecords);
  }

  /**
   * Given a list of records, return a list of all unique nodes in the records
   * @param records
   * @param allContainRelationships
   * @param selectedId
   */
  private getAllNodes(
    records: Record<INeo4jComponentPath>[],
    allContainRelationships: Neo4jRelationshipMappings,
    selectedId?: string,
  ): MapSet<Node> {
    const nodeSet: MapSet<Node> = new MapSet();
    records.forEach((r) => [r.get('source'), r.get('target')]
      .forEach((field) => {
        const nodeId = field.elementId;
        if (nodeSet.has(nodeId)) return;
        nodeSet.set(nodeId, {
          data: ElementParserService.toNodeData(field, selectedId),
        });
      }));
    const nodes = this.calculateDependencyProfile(nodeSet, allContainRelationships, records);
    if (nodes.size !== nodeSet.size) {
      throw new Error('Some nodes disappeared in calculcating dependency profiles');
    }
    return nodes;
  }

  /**
   * Recursively calculate the dependency profiles for the given
   * nodes within the context of the graph
   * @param layerNodes Set of nodes that are in the same layer in the graph
   * @param allNodes All nodes in the graph (to find the parents)
   * @param containEdges All containment edges in the graph (to find the parents)
   * @private
   */
  private getDependencyProfile(
    layerNodes: MapSet<Node>,
    allNodes: MapSet<Node>,
    allContainRelationships: Neo4jRelationshipMappings,
  ): MapSet<Node> {
    // const layerEdges = containEdges.filter((e) => layerNodes.has(e.data.target));
    // if (layerEdges.size === 0) return new MapSet<Node>();
    // const parents = allNodes.filter((n) => !!layerEdges.find((e) => e.data.source === n.data.id));
    const parentIds = layerNodes.map((n) => allContainRelationships.targetToSource.get(n.data.id))
      .filter((p) => p !== undefined)
      .map((p) => p!)
      .filter(filterDuplicates);
    if (parentIds.length === 0) return new MapSet<Node>();

    const parentList = parentIds.map((id) => allNodes.get(id)).map((p) => p!!);
    const parents = MapSet.from(...parentList);

    return parents.reduce((newMap, p) => {
      // const children = layerEdges
      //   .filter((e) => e.data.source === p.data.id)
      //   .map((e) => layerNodes.get((e.data.target))!);
      const children: Node[] = (allContainRelationships.sourceToTargets.get(p.data.id) ?? [])
        .map((childId) => allNodes.get(childId))
        .filter((n) => n !== undefined)
        .map((n) => n!);
      const dependencyProfile = children.reduce((newProfile, child) => newProfile
        .map((a, i) => child.data.properties.dependencyProfile[i]), [0, 0, 0, 0]);
      newMap.set(p.data.id, {
        data: {
          ...p.data,
          properties: {
            ...p.data.properties,
            dependencyProfile,
          },
        },
      });
      return newMap;
    }, new MapSet<Node>())
      .concat(this.getDependencyProfile(parents, allNodes, allContainRelationships));
  }

  /**
   * Given a set of nodes, calculate the dependency profile for each node
   * @param nodes
   * @param allContainRelationships
   * @param records
   * @private
   */
  private calculateDependencyProfile(
    nodes: MapSet<Node>,
    allContainRelationships: Neo4jRelationshipMappings,
    records: Record<INeo4jComponentPath>[],
  ): MapSet<Node> {
    const containSet: MapSet<Edge> = new MapSet();
    records.forEach((r) => r.get('path')
      .forEach((relationship) => {
        const relationId = relationship.elementId;
        if (relationship.type !== 'CONTAINS' || containSet.has(relationId)) return;
        containSet.set(relationId, {
          data: ElementParserService.toEdgeData(relationship),
        });
      }));

    // Get all nodes that do not have any children
    const leafNodes = nodes.filter((n) => !allContainRelationships.sourceToTargets.has(n.data.id));
    return this.getDependencyProfile(leafNodes, nodes, allContainRelationships).concat(leafNodes);
  }

  /**
   * Return the given records, but split/group the relationships into chunks of the same
   * type of relationship. See also this.groupRelationships().
   * @param records
   * @param allContainRelationships
   * @param selectedDomain
   */
  private splitRelationshipsIntoChunks(
    records: Record<INeo4jComponentPath>[],
    allContainRelationships: Neo4jRelationshipMappings,
    selectedDomain: boolean,
  ): Neo4jComponentPath[] {
    const contextNodes = this.context ? this.context.nodes.concat(this.nodes) : this.nodes;

    return records.map((record) => (new Neo4jComponentPath(
      record,
      contextNodes,
      allContainRelationships,
      selectedDomain,
    )));
  }

  /**
   * Keep only the paths that go from selected node to the domain node of the relationship
   * We have to delete any duplicates, because otherwise all these extra paths count towards
   * the total number of relationship a leaf has.
   * @param records
   */
  private onlyKeepLongestPaths(records: Neo4jComponentPath[]) {
    const seenPaths = new Map<string, number>();
    return records
      .map((record) => {
        // String that will uniquely identify this dependency (sequence).
        const pathId = record.dependencyEdges.flat().map((e) => e.elementId).join(',');

        let currDepth = 0;
        if (seenPaths.has(pathId)) {
          currDepth = seenPaths.get(pathId)!;
        }

        seenPaths.set(pathId, Math.max(currDepth, record.targetDepth));

        return record;
      }).filter((record) => {
        const pathId = record.dependencyEdges.flat().map((e) => e.elementId).join(',');
        const depth = seenPaths.get(pathId) || 0;

        return record.targetDepth === depth;
      });
  }
}
