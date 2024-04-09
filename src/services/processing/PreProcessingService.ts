import { Record } from 'neo4j-driver';
import { IntermediateGraph, Neo4jComponentPath } from '../../entities';
import { INeo4jComponentPath, Neo4jRelationshipMappings } from '../../database/entities';
import { MapSet } from '../../entities/MapSet';
import { filterDuplicates } from '../../helpers/array';
import Neo4jComponentNode from '../../entities/Neo4jComponentNode';

export default class PreProcessingService {
  public readonly nodes: MapSet<Neo4jComponentNode>;

  public readonly selectedNode?: Neo4jComponentNode;

  public readonly records: Neo4jComponentPath[];

  /**
   * @param records Unprocessed Neo4j paths
   * @param selectedId ID of the selected node (to highlight it)
   * @param context Optional graph that can provide more context to the given records,
   * i.e. when nodes or edges are missing from the given records.
   * @param selectedDomain Whether the starting point of the selection is one or more domains.
   * Overridden by selectedId, if it exists.
   * @param excludedDomains List of top level nodes' names that are not allowed in
   * the returned graph
   */
  constructor(
    records: Record<INeo4jComponentPath>[],
    public readonly selectedId?: string,
    public readonly context?: IntermediateGraph,
    selectedDomain: boolean = true,
    excludedDomains: string[] = [],
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
          if (targets && !targets.includes(rel.endNodeElementId)) {
            targets?.push(rel.endNodeElementId);
          }
        } else {
          allContainRelationships.sourceToTargets
            .set(rel.startNodeElementId, [rel.endNodeElementId]);
        }
      }));

    this.nodes = this.getAllNodes(records, allContainRelationships, selectedId);
    this.selectedNode = this.nodes.get(selectedId);

    const chunkRecords = this.splitRelationshipsIntoChunks(
      records,
      this.selectedNode ? this.selectedNode.layer === 'Domain' : selectedDomain,
    );
    this.records = this.onlyKeepLongestPaths(chunkRecords);
    this.records = this.excludeDomains(excludedDomains);
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
  ): MapSet<Neo4jComponentNode> {
    const currentNodeSet = new MapSet<Neo4jComponentNode>();
    records.forEach((r) => [r.get('source'), r.get('target')]
      .forEach((field) => {
        const nodeId = field.elementId;
        if (currentNodeSet.has(nodeId)) return;
        currentNodeSet.set(nodeId, new Neo4jComponentNode(field, selectedId));
      }));

    const nodeSet = this.context ? currentNodeSet.concat(this.context.nodes) : currentNodeSet;
    nodeSet.forEach((n) => n.setParentChildNodes(nodeSet, allContainRelationships));
    if (selectedId) nodeSet.forEach((n) => n.markIfInSelection(selectedId));

    this.calculateDependencyProfile(nodeSet);
    return nodeSet;
  }

  /**
   * Recursively calculate the dependency profiles for the given
   * nodes within the context of the graph
   * @param layerNodes Set of nodes that are in the same layer in the graph
   * @private
   */
  private getDependencyProfile(
    layerNodes: MapSet<Neo4jComponentNode>,
  ): void {
    const parentList = layerNodes.map((n) => n.parent)
      .filter((p) => p != null)
      .map((p) => p!)
      .filter(filterDuplicates);
    if (parentList.length === 0) return;
    const parents = MapSet.from((n) => n.elementId, ...parentList);

    parents.forEach((parent) => {
      // eslint-disable-next-line no-param-reassign
      parent.dependencyProfile = parent.children
        .reduce((newProfile, child) => {
          const childProfile = child.dependencyProfile;
          const result = newProfile.map((x, i) => x + childProfile[i]);
          return [result[0], result[1], result[2], result[3]];
        }, [0, 0, 0, 0]);
    });
    this.getDependencyProfile(parents);
  }

  /**
   * Given a set of nodes, calculate the dependency profile for each node
   * @param nodes
   * @private
   */
  private calculateDependencyProfile(
    nodes: MapSet<Neo4jComponentNode>,
  ): void {
    // Get all nodes that do not have any children
    const leafNodes = nodes.filter((n) => n.children.length === 0);
    this.getDependencyProfile(leafNodes);
  }

  /**
   * Return the given records, but split/group the relationships into chunks of the same
   * type of relationship. See also this.groupRelationships().
   * @param records
   * @param selectedDomain
   */
  private splitRelationshipsIntoChunks(
    records: Record<INeo4jComponentPath>[],
    selectedDomain: boolean,
  ): Neo4jComponentPath[] {
    // Merge the nodes from this query with the context and not vice-versa, because only the first
    // of duplicate nodes is used. Nodes from the context might not contain all references to their
    // parent nodes.
    const contextNodes = this.context ? this.nodes.concat(this.context.nodes) : this.nodes;

    return records.map((record) => (new Neo4jComponentPath(
      record,
      contextNodes,
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

  /*
   * Remove all paths that have at least one node in the path in one of the given domains.
   * This unfortunately cannot easily be done using a Cypher query, because this would
   * only exclude all paths that have one of excluded domains as end (target) node.
   */
  private excludeDomains(domains: string[]) {
    if (domains.length === 0) return this.records;

    return this.records.filter((records) => {
      const domainsInPath = records.dependencyEdges.map((d) => [
        d.endNode.getTopLevelParent(),
        d.startNode.getTopLevelParent(),
      ]).flat()
        .map((d) => d.properties.fullName)
        .filter(filterDuplicates);
      return domainsInPath.every((d) => !domains.includes(d));
    });
  }
}
