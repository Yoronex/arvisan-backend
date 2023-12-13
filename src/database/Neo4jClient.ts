import neo4j from 'neo4j-driver';
import { Graph } from '../entities/Graph';
import { Edge } from '../entities/Edge';

export interface QueryOptions {
  id: string;
  graphDepth: number,
  onlyInternalRelations?: boolean,
  onlyExternalRelations?: boolean,
}

export class Neo4jClient {
  private driver = neo4j.driver(process.env.NEO4J_URL || '', neo4j.auth.basic(process.env.NEO4J_USERNAME || '', process.env.NEO4J_PASSWORD || ''));

  async destroy() {
    await this.driver.close();
  }

  async getAllDomains() {
    const session = this.driver.session();
    const result = await session.run('MATCH (d: Domain) return d');
    await session.close();
    return this.formatToLPG(result.records);
  }

  async getDomainModules({
    id, graphDepth, onlyExternalRelations, onlyInternalRelations,
  }: QueryOptions) {
    const session = this.driver.session();
    let query = `
            MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[r1:CONTAINS*0..5]->(moduleOrLayer) // Get all modules that belong to the selected node
            OPTIONAL MATCH (moduleOrLayer)-[r2*1..${graphDepth}]->(dependency:Module)                                           // Get the dependencies of the modules with given depth
            MATCH (selectedNode)<-[r3:CONTAINS*0..5]-(selectedParent)                                                  // Find all the parents of the selected node (up to the domain)
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                             // Get the domain of the selected node
            MATCH (dependency)<-[r4:CONTAINS*0..5]-(parent)                                                            // Get the layers, application and domain of all dependencies
            WHERE true `;
    if (onlyInternalRelations) {
      query += 'AND (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should be in the same domain
    }
    if (onlyExternalRelations) {
      // TODO: Fix exclusion of all non-module nodes between the selected
      //  node and modules (like (sub)layers)
      query += 'AND NOT (selectedDomain:Domain)-[:CONTAINS*]->(dependency) '; // Dependency should not be in the same domain
    }
    query += 'RETURN DISTINCT selectedNode, r1, r2, r3, r4, moduleOrLayer, dependency, selectedParent, parent';

    const result = await session.run(query);
    await session.close();
    return this.formatToLPG(result.records, id);
  }
  //
  // AND (selectedDomain)-[:CONTAINS*]->(dependency)

  formatToLPG(records: any[], id?: string): Graph {
    const nodes = records
      .map((r) => r._fields
        .filter((field: any) => !Array.isArray(field))
        .map((field: any) => ({
          data: {
            id: field.elementId,
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
        })))
      .flat()
      .filter((node, index, all) => all.findIndex((n2) => n2.data.id === node.data.id) === index);

    const edges: Edge[] = records
      .map((record) => record._fields
        .filter((field: any) => Array.isArray(field))
        .map((relationships: any) => relationships.map((r: any): Edge => ({
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
        }))))
      .flat()
      .flat()
      .filter((e1, index, all) => index === all
        .findIndex((e2) => e1.data.id === e2.data.id));

    return {
      nodes,
      edges,
    };
  }
}
