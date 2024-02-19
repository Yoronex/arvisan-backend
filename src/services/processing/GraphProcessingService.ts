import { Record } from 'neo4j-driver';
import { Graph, Edge } from '../../entities';
import { Node, NodeData } from '../../entities/Node';
import {
  Neo4jComponentDependency,
  Neo4jComponentNode,
  Neo4jComponentPath,
  Neo4jComponentPathWithChunks,
} from '../../database/entities';
import { EdgeData } from '../../entities/Edge';

/**
 * @property selectedId - ID of the selected node to highlight it
 * @property reverseDirection - Whether the filters should be applied to the
 * "target" node instead of the "source"
 * @property maxDepth - How deep the "CONTAIN" edges on the target side should go.
 * If there is a path between two nodes too deep, create a transitive edge
 */
export interface GraphFilterOptions {
  selectedId?: string;
  reverseDirection?: boolean;
  maxDepth?: number;
  minRelationships?: number;
  maxRelationships?: number;
  selfEdges?: boolean;
}

export default class GraphProcessingService {
  /**
   * Given a Neo4j node, format it to a CytoScape NodeData object
   * @param node
   * @param selectedId
   */
  public formatNeo4jNodeToNodeData(node: Neo4jComponentNode, selectedId?: string): NodeData {
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
  public formatNeo4jRelationshipToEdgeData(
    edge: Neo4jComponentDependency,
  ): EdgeData {
    return {
      id: edge.elementId,
      source: edge.startNodeElementId,
      target: edge.endNodeElementId,
      interaction: edge.type.toLowerCase(),
      properties: {
        weight: 1,
        violation: 'false',
      },
    };
  }

  /**
   * Given a list of Neo4j relationships, split those relationships into a 2D list
   * such that the first and last list only have "CONTAINS" relationships.
   * This is necessary to traverse up and down the "tree" of nodes.
   * If there are only "CONTAINS" relationships in the given list, the result will contain
   * two lists, one with relationships going "down" and the other going "up".
   * @param relationships
   * @param reverseDirection
   * @private
   */
  private groupRelationships(
    relationships: Neo4jComponentDependency[],
    reverseDirection?: boolean,
  ): Neo4jComponentDependency[][] {
    if (relationships.length === 0) return [[]];
    const chunks = [[relationships[0]]];
    for (let i = 1; i < relationships.length; i += 1) {
      if (relationships[i].type === chunks[chunks.length - 1][0].type) {
        chunks[chunks.length - 1].push(relationships[i]);
      } else {
        chunks.push([relationships[i]]);
      }
    }

    // No dependency edges, only containment edges. However, these might go down and immediately
    // go back up. Therefore, we need to find where to split this single array of CONTAIN edges
    if (chunks.length === 1) {
      const lastContainEdge = chunks[0][chunks[0].length - 1];
      const index = chunks[0].findIndex((e) => e.elementId === lastContainEdge.elementId);
      // The last CONTAIN edge in the chain exists only once, so we are not going back up.
      // Push an empty array.
      if (index === chunks[0].length - 1 && !reverseDirection) {
        chunks.push([]);
      } else if (index === chunks[0].length - 1) {
        chunks.unshift([]);
      } else if (!reverseDirection) {
        const dependencyParents = chunks[0].splice(index + 1, chunks[0].length - 1 - index);
        chunks.push(dependencyParents);
      } else {
        const dependencyParents = chunks[0].splice(0, index);
        chunks.unshift(dependencyParents);
      }
    } else {
      // If we do not start with any CONTAIN edges, push an empty array to the front to indicate
      // that we do not have such edges
      if (chunks[0][0].type.toLowerCase() !== 'contains') chunks.unshift([]);
      // If we do not end with any CONTAIN edges, push an empty array to the back to indicate
      // that we do not have such edges
      if (chunks[chunks.length - 1][0]?.type.toLowerCase() !== 'contains' || chunks.length === 1) chunks.push([]);
    }
    return chunks;
  }

  /**
   * Given a complete Neo4j graph query result, create a mapping from module IDs
   * to their abstractions
   * @param records
   * @param maxDepth
   * @param reverseDirection
   */
  getAbstractionMap(
    records: Neo4jComponentPathWithChunks[],
    maxDepth: number,
    reverseDirection?: boolean,
  ): Map<string, string> {
    // Replace all transitive nodes with this existing end node (the first of the full path)
    const replaceMap = new Map<string, string>();
    const addToReplaceMap = (deletedEdges: Neo4jComponentDependency[]) => {
      if (deletedEdges.length === 0) return;
      const firstStartNode = deletedEdges[0].startNodeElementId;
      deletedEdges.forEach((edge) => replaceMap
        .set(edge.endNodeElementId, firstStartNode));
    };

    records.forEach((record) => {
      const { chunks } = record;

      const containsSourceDepth = chunks[0][0]?.type.toLowerCase() === 'contains' ? chunks[0].length : 0;
      const containsTargetDepth = chunks[chunks.length - 1][0]?.type.toLowerCase() === 'contains' ? chunks[chunks.length - 1].length : 0;
      if (!reverseDirection) {
        const containsTooDeep = Math.max(0, containsSourceDepth - maxDepth);

        const deletedSource = chunks[0].splice(maxDepth, containsTooDeep);
        addToReplaceMap(deletedSource);

        const deletedTarget = chunks[chunks.length - 1]
          .splice(containsTargetDepth - containsTooDeep, containsTooDeep);
        addToReplaceMap(deletedTarget);
      } else {
        const containsTooDeep = Math.max(0, containsTargetDepth - maxDepth);

        const deletedSource = chunks[0]
          .splice(containsSourceDepth - containsTooDeep, containsTooDeep);
        addToReplaceMap(deletedSource);

        const deletedTarget = chunks[chunks.length - 1].splice(maxDepth, containsTooDeep);
        addToReplaceMap(deletedTarget);
      }
    });

    return replaceMap;
  }

  /**
   * Given a list of records, return a list of all unique nodes in the records
   * @param records
   * @param selectedId
   */
  getAllNodes(records: Record<Neo4jComponentPath>[], selectedId?: string): Node[] {
    const seenNodes: string[] = [];
    return records
      .map((r) => [r.get('source'), r.get('target')]
        .map((field): Node | undefined => {
          const nodeId = field.elementId;
          if (seenNodes.indexOf(nodeId) >= 0) return undefined;
          seenNodes.push(nodeId);
          return {
            data: this.formatNeo4jNodeToNodeData(field, selectedId),
          };
        }))
      .flat()
      .filter((node) => node !== undefined) as Node[];
  }

  /**
   * Given a list of records, return a list of all edges in the records, all having weight 1.
   * The resulting list might include duplicate edges.
   * @param records
   */
  getAllEdges(records: Neo4jComponentPathWithChunks[]): Edge[] {
    const seenEdges: string[] = [];
    return records
      .map((record) => record.chunks.flat().map((r): Edge | undefined => {
        const edgeId = r.elementId;
        if (seenEdges.indexOf(edgeId) >= 0) return undefined;
        seenEdges.push(edgeId);
        return {
          data: this.formatNeo4jRelationshipToEdgeData(r),
        };
      }))
      .flat()
      .flat()
      .filter((edge) => edge !== undefined)
      // Typescript is being stupid, so set typing so all edges exist
      .map((edge): Edge => edge!);
  }

  /**
   * Given a list of edges, merge two edges with the same source and target node.
   * The merged edge's weight will be the sum of both edge weights.
   * @param edges
   */
  mergeDuplicateEdges(edges: Edge[]): Edge[] {
    return edges.reduce((newEdges: Edge[], edge) => {
      const index = newEdges.findIndex((e) => e.data.source === edge.data.source
        && e.data.target === edge.data.target);
      if (index < 0) return [...newEdges, edge];
      // eslint-disable-next-line no-param-reassign
      newEdges[index].data.properties.weight += edge.data.properties.weight;
      return newEdges;
    }, []);
  }

  /**
   * Return the given records, but split/group the relationships into chunks of the same
   * type of relationship. See also this.groupRelationships().
   * @param records
   */
  splitRelationshipsIntoChunks(
    records: Record<Neo4jComponentPath>[],
  ): Neo4jComponentPathWithChunks[] {
    return records
      .map((record) => record.toObject())
      .map((record) => ({
        source: record.source,
        chunks: this.groupRelationships(record.path),
        target: record.target,
      }));
  }

  /**
   * Keep only the paths that go from selected node to the domain node of the relationship
   * We have to delete any duplicates, because otherwise all these extra paths count towards
   * the total number of relationship a leaf has.
   * @param records
   */
  onlyKeepLongestPaths(records: Neo4jComponentPathWithChunks[]) {
    const seenPaths = new Map<string, number>();
    return records
      .map((record) => {
        const { chunks } = record;
        // String that will uniquely identify this dependency (sequence).
        const pathId = chunks.slice(1, chunks.length - 1).flat().map((e) => e.elementId).join(',');

        let currDepth = 0;
        if (seenPaths.has(pathId)) {
          currDepth = seenPaths.get(pathId)!;
        }

        seenPaths.set(pathId, Math.max(currDepth, chunks[chunks.length - 1].length));

        return record;
      }).filter((record) => {
        const { chunks } = record;
        const pathId = chunks.slice(1, chunks.length - 1).flat().map((e) => e.elementId).join(',');
        const depth = seenPaths.get(pathId) || 0;

        return chunks[chunks.length - 1].length === depth;
      });
  }

  /**
   * Apply an abstraction based on the grouping (clustering) of the nodes
   * @param records List of paths
   * @param abstractionMap Mapping with which node ids should be abstracted to which node ids
   */
  applyAbstraction(records: Neo4jComponentPathWithChunks[], abstractionMap: Map<string, string>) {
    return records.map((record): Neo4jComponentPathWithChunks => {
      const { chunks } = record;
      const toEdit = chunks.slice(1, chunks.length - 1);

      return {
        ...record,
        chunks: [
          chunks[0],
          toEdit.map((chunk) => chunk.map((e): Neo4jComponentDependency => {
            if (abstractionMap.has(e.startNodeElementId)) {
              e.startNodeElementId = abstractionMap.get(e.startNodeElementId) as string;
            }
            if (abstractionMap.has(e.endNodeElementId)) {
              e.endNodeElementId = abstractionMap.get(e.endNodeElementId) as string;
            }
            return e;
          })).flat(),
          chunks[chunks.length - 1],
        ] as Neo4jComponentDependency[][],
      };
    });
  }

  /**
   * Apply a filtering based on the amount of incoming and outgoing relationships
   * @param records
   * @param minRelationships
   * @param maxRelationships
   */
  applyMinMaxRelationshipsFilter(
    records: Neo4jComponentPathWithChunks[],
    minRelationships?: number,
    maxRelationships?: number,
  ) {
    // Count how many relationships each child of the selected node has
    const relationsMap = new Map<string, string[]>();
    records.forEach(({ chunks }) => {
      if (!minRelationships && !maxRelationships) return;

      if (chunks.length <= 1 || chunks[1].length === 0) return;

      // eslint-disable-next-line prefer-destructuring
      const edge = chunks[1][0]; // Last element of first chunk
      const node = edge?.startNodeElementId;
      const relatedNode = edge?.endNodeElementId;

      if (!relationsMap.get(node)?.includes(relatedNode)) {
        const currentRelations = relationsMap.get(node) || [];
        relationsMap.set(node, [...currentRelations, relatedNode]);
      }
    });

    // Apply filter
    return records.filter(({ chunks }) => {
      if (!minRelationships && !maxRelationships) return true;

      const node = chunks[1][0]?.startNodeElementId; // Last element of first chunk

      const uniqueRelationships = relationsMap.get(node) || [];
      if (minRelationships && uniqueRelationships.length < minRelationships) return false;
      if (maxRelationships && uniqueRelationships.length > maxRelationships) return false;
      return true;
    });
  }

  /**
   * Only keep the nodes that are the start or end point of an edge
   */
  filterNodesByEdges(nodes: Node[], edges: Edge[]): Node[] {
    const nodesOnPaths: string[] = edges
      // Get the source and target from each edge
      .map((e) => [e.data.source, e.data.target])
      // Flatten the 2D array
      .flat()
      // Remove duplicates
      .filter((n1, i, all) => i === all.findIndex((n2) => n1 === n2));
    // Filter the actual node objects
    return nodes.filter((n) => nodesOnPaths.includes(n.data.id));
  }

  /**
   * Remove all self-edges (edges where the source and target is the same node)
   */
  filterSelfEdges(edges: Edge[]): Edge[] {
    return edges.filter((e) => e.data.source !== e.data.target);
  }

  /**
   * Replace every given edge with a parent relationship, which is supported by Cytoscape.
   */
  addParentRelationship(nodes: Node[], parentEdges: Edge[]): Node[] {
    const nodesCopy: Node[] = [...nodes];
    parentEdges.forEach((e) => {
      const target = nodesCopy.find((n) => n.data.id === e.data.target);
      if (!target) return;
      target.data.parent = e.data.source;
    });
    return nodesCopy;
  }

  /**
   * Parse the given Neo4j query result to a LPG
   * @param records
   * @param name graph name
   * @param options
   */
  formatToLPG(
    records: Record<Neo4jComponentPath>[],
    name: string,
    options: GraphFilterOptions = {},
  ) {
    const {
      selectedId, maxDepth,
      minRelationships, maxRelationships, selfEdges,
    } = options;

    // Process the nodes at the beginning, because records that are no maximal path are deleted
    // Then, we lose crucial information on the nodes on these paths
    // We should filter these nodes later; only keep the nodes that lay on one or more paths
    let nodes = this.getAllNodes(records, selectedId);

    const recordsToProcess = this.splitRelationshipsIntoChunks(records);

    // Keep only the paths that go from selected node to the domain node of the relationship
    // We have to delete any duplicates, because otherwise all these extra paths count towards
    // the total number of relationship a leaf has.
    let filteredRecords = this.onlyKeepLongestPaths(recordsToProcess);

    // Find the nodes that need to be replaced (and with which nodes).
    // Also, already remove the too-deep nodes
    let replaceMap: Map<string, string> | undefined;
    if (maxDepth !== undefined) {
      replaceMap = this.getAbstractionMap(filteredRecords, maxDepth);
      filteredRecords = this.applyAbstraction(filteredRecords, replaceMap);
    }

    // Count how many relationships each child of the selected node has
    filteredRecords = this
      .applyMinMaxRelationshipsFilter(filteredRecords, minRelationships, maxRelationships);

    const edges = this.mergeDuplicateEdges(this.getAllEdges(filteredRecords));

    nodes = this.filterNodesByEdges(nodes, edges);

    // Split the list of edges into "contain" edges and all other edges
    const containEdges = edges.filter((e) => e.data.interaction === 'contains');
    let dependencyEdges = edges.filter((e) => e.data.interaction !== 'contains');

    // Replace every "contain" edge with a parent relationship, which is supported by Cytoscape.
    nodes = this.addParentRelationship(nodes, containEdges);

    if (selfEdges === false) {
      dependencyEdges = this.filterSelfEdges(dependencyEdges);
    }

    const graph: Graph = {
      name,
      nodes,
      edges: dependencyEdges,
    };

    return {
      graph,
      replaceMap,
    };
  }
}
