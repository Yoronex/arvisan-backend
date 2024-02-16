import neo4j, { Record, RecordShape } from 'neo4j-driver';

export class Neo4jClient {
  private driver = neo4j.driver(process.env.NEO4J_URL || '', neo4j.auth.basic(process.env.NEO4J_USERNAME || '', process.env.NEO4J_PASSWORD || ''));

  /**
   * Execute the given query and process the results
   * @param query
   * @private
   */
  public async executeQuery<T extends RecordShape>(
    query: string,
  ): Promise<Array<Record<T>>> {
    const session = this.driver.session();
    const result = await session.executeRead(
      (tx) => tx.run(query),
      { timeout: 5000 },
    );
    await session.close();

    return result.records;
  }

  async destroy() {
    await this.driver.close();
  }
}
