import {
  Body, Controller, Get, Post, Route, Tags,
} from 'tsoa';
import { Neo4jClient, QueryOptions } from '../database/Neo4jClient';

@Route('graph')
@Tags('graph')
export class GraphController extends Controller {
  @Get('domains')
  public async getAllDomains() {
    const client = new Neo4jClient();
    const graph = await client.getAllDomains();
    await client.destroy();

    return graph;
  }

  @Post('node')
  public async getNode(@Body() params: QueryOptions) {
    const client = new Neo4jClient();
    try {
      const graph = await client.getDomainModules(params);
      await client.destroy();
      return graph;
    } catch (e: any) {
      if (e.name === 'Neo4jError' && e.code === 'Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration') {
        this.setStatus(400);
        return { message: 'Query is too big to finish in 5 seconds' };
      }
      throw e;
    }
  }
}
