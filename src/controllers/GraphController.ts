import {
  Body, Controller, Get, Post, Route, Tags,
} from 'tsoa';
import GraphVisualizationService, { QueryOptions } from '../services/GraphVisualizationService';
import GraphPropertiesService from '../services/GraphPropertiesService';

@Route('graph')
@Tags('graph')
export class GraphController extends Controller {
  @Get('domains')
  public async getAllDomains() {
    return new GraphPropertiesService().getAllDomains();
  }

  @Post('node')
  public async getNode(@Body() params: QueryOptions) {
    try {
      return await new GraphVisualizationService().getGraphFromSelectedNode(params);
    } catch (e: any) {
      if (e.name === 'Neo4jError' && e.code === 'Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration') {
        this.setStatus(400);
        return { message: 'Query is too big to finish in 5 seconds' };
      }
      throw e;
    }
  }
}
