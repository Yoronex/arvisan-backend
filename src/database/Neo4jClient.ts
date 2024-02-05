import neo4j, { Record } from 'neo4j-driver';
import { Graph } from '../entities/Graph';

export type Neo4jGraph = {
  source: any;
  path: any[];
  target: any;
};

export class Neo4jClient {
  private driver = neo4j.driver(process.env.NEO4J_URL || '', neo4j.auth.basic(process.env.NEO4J_USERNAME || '', process.env.NEO4J_PASSWORD || ''));

  /**
   * Execute the given query and process the results
   * @param query
   * @param processing
   * @private
   */
  public async executeAndProcessQuery<T extends Neo4jGraph>(
    query: string,
    processing: (records: Array<Record<T>>) => Graph,
  ) {
    const session = this.driver.session();
    const result = await session.executeRead(
      (tx) => tx.run<T>(query),
      { timeout: 5000 },
    );
    await session.close();

    return processing(result.records);
  }

  async destroy() {
    await this.driver.close();
  }
}
