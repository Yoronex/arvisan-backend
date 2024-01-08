import neo4j, {
  Integer, Node as Neo4jNode, Record, Relationship as Neo4jRelationship,
} from 'neo4j-driver';
import { Graph } from '../entities/Graph';
import { Edge } from '../entities/Edge';
import { Node } from '../entities/Node';

export interface QueryOptions {
  id: string;
  layerDepth: number,
  dependencyDepth: number,
  onlyInternalRelations?: boolean,
  onlyExternalRelations?: boolean,
  showDependencies?: boolean,
  showDependents?: boolean,
  dependencyRange?: {
    min?: number;
    max?: number;
  },
  dependentRange?: {
    min?: number;
    max?: number;
  },
}

type Neo4jComponentNode = Neo4jNode<Integer, {
  color: string;
  depth: number;
  id: string;
  kind: string;
  simpleName: string;
}>;

type Neo4jComponentDependency = Neo4jRelationship<Integer, {
  id: string;
}>;

interface Neo4jComponentGraph {
  source: Neo4jComponentNode;
  path: Neo4jComponentDependency[];
  target: Neo4jComponentNode;
}

/**
 * @property selectedId - ID of the selected node to highlight it
 * @property reverseDirection - Whether the filters should be applied to the
 * "target" node instead of the "source"
 * @property maxDepth - How deep the "CONTAIN" edges on the target side should go.
 * If there is a path between two nodes too deep, create a transitive edge
 */
interface GraphFilterOptions {
  selectedId?: string;
  reverseDirection?: boolean;
  maxDepth?: number;
  minRelationships?: number;
  maxRelationships?: number;
}

export class Neo4jClient {
  private driver = neo4j.driver(process.env.NEO4J_URL || '', neo4j.auth.basic(process.env.NEO4J_USERNAME || '', process.env.NEO4J_PASSWORD || ''));

  private filterDuplicateNodes(nodes: Node[]): Node[] {
    return nodes.filter((n, i, all) => i === all.findIndex((n2) => n2.data.id === n.data.id));
  }

  private filterDuplicateEdges(edges: Edge[]): Edge[] {
    return edges.filter((e, i, all) => i === all.findIndex((e2) => e2.data.id === e.data.id));
  }

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
   * Parse the given Neo4j query result to a LPG
   * @param records
   * @param name graph name
   * @param options
   */
  formatToLPG(
    records: Record<Neo4jComponentGraph>[],
    name: string,
    options: GraphFilterOptions = {},
  ): Graph {
    const {
      selectedId, maxDepth, reverseDirection, minRelationships, maxRelationships,
    } = options;

    // Process the nodes at the beginning, as records that are no maximal path are deleted
    // Then, we lose crucial information on the nodes on these paths
    // We should filter these nodes later; only keep the nodes that lay on one or more paths
    const seenNodes: string[] = [];
    let nodes = records
      .map((r) => [r.get('source'), r.get('target')]
        .map((field): Node | undefined => {
          const nodeId = field.elementId;
          if (seenNodes.indexOf(nodeId) >= 0) return undefined;
          seenNodes.push(nodeId);
          return {
            data: {
              id: nodeId,
              properties: {
                simpleName: field.properties.simpleName,
                kind: field.properties.kind,
                traces: [],
                color: field.properties.color,
                depth: Number(field.properties.depth),
                selected: field.elementId === selectedId ? 'true' : 'false',
              },
              labels: field.labels,
            },
          };
        }))
      .flat()
      .filter((node) => node !== undefined) as Node[];

    // Keep only the paths that go from selected node to the domain node of the relationship
    // We have to delete any duplicates, because otherwise all these extra paths count towards
    // the total number of relationship a leaf has.
    const seenPaths = new Map<string, number>();
    let filteredRecords = records.map((record) => record.toObject())
      .map((record) => {
        const { path } = record;
        const chunks = this.groupRelationships(path, reverseDirection);
        const pathId = chunks.slice(1, chunks.length - 1).flat().map((e) => e.elementId).join(',');

        let currDepth = 0;
        if (seenPaths.has(pathId)) {
          currDepth = seenPaths.get(pathId)!;
        }

        if (reverseDirection) {
          seenPaths.set(pathId, Math.max(currDepth, chunks[0].length));
        } else {
          seenPaths.set(pathId, Math.max(currDepth, chunks[chunks.length - 1].length));
        }
        return record;
      }).filter((record) => {
        const { path } = record;
        const chunks = this.groupRelationships(path, reverseDirection);
        const pathId = chunks.slice(1, chunks.length - 1).flat().map((e) => e.elementId).join(',');
        const depth = seenPaths.get(pathId) || 0;

        if (reverseDirection) {
          return chunks[0].length === depth;
        }
        return chunks[chunks.length - 1].length === depth;
      });

    // Replace all transitive nodes with this existing end node (the first of the full path)
    const replaceMap = new Map<string, string>();
    const addToReplaceMap = (deletedEdges: Neo4jComponentDependency[]) => {
      if (deletedEdges.length === 0) return;
      const firstStartNode = deletedEdges[0].startNodeElementId;
      deletedEdges.forEach((edge) => replaceMap
        .set(edge.endNodeElementId, firstStartNode));
    };

    // Find the nodes that need to be replaced (and with which nodes).
    // Also, already remove the too-deep nodes
    if (maxDepth !== undefined) {
      filteredRecords = filteredRecords.map((record): Neo4jComponentGraph => {
        const { path } = record;
        const chunks = this.groupRelationships(path, reverseDirection);

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

        return {
          ...record,
          path: [
            ...chunks[0],
            ...chunks.slice(1, chunks.length - 1).flat(),
            ...chunks[chunks.length - 1],
          ] as Neo4jComponentDependency[],
        };
        // Replace the source and target nodes of the dependency edges to make them transitive
      }).map((record): Neo4jComponentGraph => {
        const { path } = record;
        const chunks = this.groupRelationships(path, reverseDirection);
        const toEdit = chunks.slice(1, chunks.length - 1);

        return {
          ...record,
          path: [
            ...chunks[0],
            ...toEdit.map((chunk) => chunk.map((e): Neo4jComponentDependency => {
              if (replaceMap.has(e.startNodeElementId)) {
                e.startNodeElementId = replaceMap.get(e.startNodeElementId) as string;
              }
              if (replaceMap.has(e.endNodeElementId)) {
                e.endNodeElementId = replaceMap.get(e.endNodeElementId) as string;
              }
              return e;
            })).flat(),
            ...chunks[chunks.length - 1],
          ] as Neo4jComponentDependency[],
        };
      });
    }

    // Count how many relationships each child of the selected node has
    const relationsMap = new Map<string, string[]>();
    filteredRecords.forEach((record) => {
      if (!minRelationships && !maxRelationships) return;

      const chunks = this.groupRelationships(record.path, reverseDirection);
      if (chunks.length <= 1 || chunks[1].length === 0) return;

      let node: string;
      let relatedNode: string;
      if (reverseDirection) {
        const edge = chunks[chunks.length - 2][chunks[chunks.length - 2].length - 1];
        node = edge?.endNodeElementId;
        relatedNode = edge?.startNodeElementId;
      } else {
        // eslint-disable-next-line prefer-destructuring
        const edge = chunks[1][0]; // Last element of first chunk
        node = edge?.startNodeElementId;
        relatedNode = edge?.endNodeElementId;
      }

      if (!relationsMap.get(node)?.includes(relatedNode)) {
        const currentRelations = relationsMap.get(node) || [];
        relationsMap.set(node, [...currentRelations, relatedNode]);
      }
    });

    // Apply filter
    filteredRecords = filteredRecords.filter((record) => {
      if (!minRelationships && !maxRelationships) return true;

      const chunks = this.groupRelationships(record.path, reverseDirection);

      let node: string;
      if (reverseDirection) {
        node = chunks[chunks.length - 2][chunks[chunks.length - 2].length - 1]?.endNodeElementId;
      } else {
        node = chunks[1][0]?.startNodeElementId; // Last element of first chunk
      }

      const uniqueRelationships = relationsMap.get(node) || [];
      if (minRelationships && uniqueRelationships.length < minRelationships) return false;
      if (maxRelationships && uniqueRelationships.length > maxRelationships) return false;
      return true;
    });

    const seenEdges: string[] = [];
    const edges = filteredRecords
      .map((record) => record.path.map((r): Edge | undefined => {
        const edgeId = r.elementId;
        if (seenEdges.indexOf(edgeId) >= 0) return undefined;
        seenEdges.push(edgeId);
        return {
          data: {
            id: r.elementId,
            source: r.startNodeElementId,
            target: r.endNodeElementId,
            label: r.type.toLowerCase(),
            properties: {
              weight: 1,
              traces: [],
            },
          },
        };
      }))
      .flat()
      .flat()
      .filter((edge) => edge !== undefined)
      // Typescript is being stupid, so set typing so all edges exist
      .map((edge): Edge => edge!)
      .reduce((newEdges: Edge[], edge) => {
        const index = newEdges.findIndex((e) => e.data.source === edge.data.source
            && e.data.target === edge.data.target);
        if (index < 0) return [...newEdges, edge];
        // eslint-disable-next-line no-param-reassign
        newEdges[index].data.properties.weight += 1;
        return newEdges;
      }, []);

    const nodesOnPaths: string[] = edges
      // Get the source and target from each edge
      .map((e) => [e.data.source, e.data.target])
      // Flatten the 2D array
      .flat()
      // Remove duplicates
      .filter((n1, i, all) => i === all.findIndex((n2) => n1 === n2));
    // Filter the actual node objects
    nodes = nodes.filter((n) => nodesOnPaths.includes(n.data.id));

    return {
      name,
      nodes,
      edges,
    };
  }

  /**
   * Execute the given query and parse the result to a LPG
   * @param query
   * @param name
   * @param options
   * @private
   */
  private async executeAndProcessQuery(query: string, name: string, options?: GraphFilterOptions) {
    const session = this.driver.session();
    const result = await session.executeRead((tx) => tx.run<Neo4jComponentGraph>(query));
    await session.close();

    return this.formatToLPG(result.records, name, options);
  }

  /**
   * Merge two or more graphs into a single graph. Take out any duplicate nodes or edges
   * @param graphs
   * @private
   */
  private mergeGraphs(...graphs: Graph[]): Graph {
    const nodes = graphs.map((g) => g.nodes).flat();
    const edges = graphs.map((g) => g.edges).flat();
    const graph = {
      name: `Merged graph of '${graphs.map((g) => g.name).join(', ')}'`,
      nodes: this.filterDuplicateNodes(nodes),
      edges: this.filterDuplicateEdges(edges),
    };
    this.validateGraph(graph);
    return graph;
  }

  /**
   * Check whether the output graph does have a node for every returned edge
   * @param graph
   * @private
   */
  private validateGraph(graph: Graph) {
    const nodeIds = graph.nodes.map((n) => n.data.id);
    const invalidEdges = graph.edges
      .map((e): Edge => ({
        data: {
          ...e.data,
          source: nodeIds.includes(e.data.source) ? '' : e.data.source,
          target: nodeIds.includes(e.data.target) ? '' : e.data.target,
        },
      }))
      .filter((e) => (e.data.source !== '' || e.data.target !== ''));
    if (invalidEdges.length === 0) return;
    const message = invalidEdges.map((e) => {
      if (e.data.source === '') {
        return `Edge '${e.data.id}': unknown target '${e.data.target}'`;
      }
      if (e.data.target === '') {
        return `Edge '${e.data.id}': unknown source '${e.data.source}'`;
      }
      return `Edge '${e.data.id}': unknown source '${e.data.source}' and target '${e.data.target}'`;
    });
    throw new Error(`Graph '${graph.name}' is invalid due to the following edges: ${message.join('; ')}`);
  }

  async destroy() {
    await this.driver.close();
  }

  async getAllDomains() {
    const query = `
            MATCH (selectedNode:Domain)-[r1:CONTAINS*0..5]->(moduleOrLayer)-[r2*1..1]->(dependency:Module)   // Get all modules that belong to the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            WHERE NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) 
            RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target `;
    return this.executeAndProcessQuery(query, 'All domains', { maxDepth: 0 });
  }

  async getParents(id: string) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')<-[r:CONTAINS*0..5]-(selectedParent) 
      RETURN selectedNode as source, r as path, selectedParent as target`;
    return this.executeAndProcessQuery(query, 'All parents', { selectedId: id });
  }

  async getChildren(id: string, depth: number) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r:CONTAINS*0..${depth}]->(moduleOrLayer) 
      RETURN selectedNode as source, r as path, moduleOrLayer as target`;
    return this.executeAndProcessQuery(query, 'All sublayers and modules', { selectedId: id });
  }

  async getDomainModules({
    id, layerDepth, dependencyDepth, onlyExternalRelations, onlyInternalRelations,
    showDependencies, showDependents, dependencyRange, dependentRange,
  }: QueryOptions) {
    const buildQuery = (dependencies: boolean = true) => {
      let query = `
            MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r1:CONTAINS*0..5]->(moduleOrLayer)${!dependencies ? '<' : ''}-[r2*1..${dependencyDepth}]-${dependencies ? '>' : ''}(dependency:Module) // Get all modules that belong to the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            WHERE true `;
      if (onlyInternalRelations) {
        query += 'AND (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should be in the same domain
      }
      if (onlyExternalRelations) {
        query += 'AND NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should not be in the same domain
      }

      if (dependencies) {
        query += 'RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target';
      } else {
        query += 'RETURN DISTINCT parent as source, reverse(r3) + r2 + r1 as path, selectedNode as target';
      }
      return query;
    };

    const promises: Promise<Graph>[] = [
      this.getChildren(id, layerDepth),
      this.getParents(id),
    ];
    if (showDependencies) {
      promises.push(this.executeAndProcessQuery(buildQuery(true), 'All dependencies and their parents', {
        selectedId: id,
        maxDepth: layerDepth,
        minRelationships: dependencyRange?.min,
        maxRelationships: dependencyRange?.max,
      }));
    }
    if (showDependents) {
      promises.push(this.executeAndProcessQuery(buildQuery(false), 'All dependents and their parents', {
        selectedId: id,
        maxDepth: layerDepth,
        reverseDirection: true,
        minRelationships: dependentRange?.min,
        maxRelationships: dependentRange?.max,
      }));
    }

    const graphs = await Promise.all(promises);
    return this.mergeGraphs(...graphs);
  }
}
