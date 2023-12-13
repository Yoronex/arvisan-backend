import neo4j from 'neo4j-driver';
import { Graph } from '../entities/Graph';
import { Edge } from '../entities/Edge';
import { Node } from '../entities/Node';

export interface QueryOptions {
  id: string;
  graphDepth: number,
  onlyInternalRelations?: boolean,
  onlyExternalRelations?: boolean,
}

export class Neo4jClient {
  private driver = neo4j.driver(process.env.NEO4J_URL || '', neo4j.auth.basic(process.env.NEO4J_USERNAME || '', process.env.NEO4J_PASSWORD || ''));

  private filterDuplicateNodes(nodes: Node[]): Node[] {
    return nodes.filter((n, i, all) => i === all.findIndex((n2) => n2.data.id === n.data.id));
  }

  private filterDuplicateEdges(edges: Edge[]): Edge[] {
    return edges.filter((e, i, all) => i === all.findIndex((e2) => e2.data.id === e.data.id));
  }

  /**
   * Parse the given Neo4j query result to a LPG
   * @param records
   * @param name graph name
   * @param id ID of the selected node (to highlight it)
   */
  formatToLPG(records: any[], name: string, id?: string): Graph {
    const seenNodes: string[] = [];
    const nodes = records
      .map((r) => r._fields
        .filter((field: any) => !Array.isArray(field))
        .map((field: any): Node | undefined => {
          const nodeId = field.elementId;
          if (seenNodes.indexOf(nodeId) >= 0) return undefined;
          seenNodes.push(nodeId);
          return {
            data: {
              id: nodeId,
              properties: {
                simpleName: field.properties.simpleName,
                kind: 'node',
                traces: [],
                color: field.properties.color,
                depth: Number(field.properties.depth),
                selected: field.elementId === id ? 'true' : 'false',
              },
              labels: field.labels,
            },
          };
        }))
      .flat()
      .filter((node) => node !== undefined);

    const seenEdges: string[] = [];
    const edges: Edge[] = records
      .map((record) => record._fields
        .filter((field: any) => Array.isArray(field))
        .map((relationships: any) => relationships.map((r: any): Edge | undefined => {
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
        })))
      .flat()
      .flat()
      .filter((edge) => edge !== undefined);

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
   * @private
   */
  private async executeAndProcessQuery(query: string, name: string) {
    const session = this.driver.session();
    const result = await session.run(query);
    await session.close();

    const graph = this.formatToLPG(result.records, name);
    // this.validateGraph(graph);
    return graph;
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
    const session = this.driver.session();
    const result = await session.run('MATCH (d: Domain) return d');
    await session.close();
    return this.formatToLPG(result.records, 'All domains');
  }

  async getParents(id: string) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')<-[r:CONTAINS*0..5]-(selectedParent) 
      RETURN selectedNode, r, selectedParent`;
    return this.executeAndProcessQuery(query, 'All parents');
  }

  async getChildren(id: string) {
    const query = `
      MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r:CONTAINS*0..5]->(moduleOrLayer) 
      RETURN selectedNode, r, moduleOrLayer`;
    return this.executeAndProcessQuery(query, 'All sublayers and modules');
  }

  async getDomainModules({
    id, graphDepth, onlyExternalRelations, onlyInternalRelations,
  }: QueryOptions) {
    let query = `
            MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r1:CONTAINS*0..5]->(moduleOrLayer) // Get all modules that belong to the selected node
            OPTIONAL MATCH (moduleOrLayer)-[r2*1..${graphDepth}]->(dependency:Module)                        // Get the dependencies of the modules with given depth
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            WHERE true `;
    if (onlyInternalRelations) {
      query += 'AND (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should be in the same domain
    }
    if (onlyExternalRelations) {
      // TODO: Fix exclusion of all non-module nodes between the selected
      //  node and modules (like (sub)layers)
      query += 'AND NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should not be in the same domain
    }
    query += 'RETURN DISTINCT selectedNode, r1, r2, r3, moduleOrLayer, dependency, selectedDomain, parent';

    const graphs = await Promise.all([
      this.getChildren(id),
      this.getParents(id),
      this.executeAndProcessQuery(query, 'All dependencies and their parents'),
    ]);
    const mergedGraph = this.mergeGraphs(...graphs);
    return mergedGraph;
  }
  //
  // AND (selectedDomain)-[:CONTAINS*]->(dependency)
}
