import {
  Body, Controller, Get, Post, Route, Tags,
} from 'tsoa';
import { Neo4jClient, QueryOptions } from '../database/Neo4jClient';

@Route('graph')
@Tags('graph')
export class GraphController extends Controller {
  @Get()
  public getGraph() {
    return 'pong';
  }

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
    const graph = await client.getDomainModules(params);
    await client.destroy();

    return graph;
  }
}
