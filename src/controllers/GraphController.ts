import {
  Body, Controller, Post, Route, Tags, Response, Res,
} from 'tsoa';
import { TsoaResponse } from '@tsoa/runtime';
import VisualizationService, { QueryOptions } from '../services/VisualizationService';
import { GraphWithViolations } from '../entities/Graph';
import ElementParserService from '../services/processing/ElementParserService';

interface ErrorResponse {
  message: string;
}

@Route('graph')
@Tags('Graph')
export class GraphController extends Controller {
  @Post('node')
  @Response<ErrorResponse>(400, 'Invalid query')
  public async getNode(
    @Body() params: QueryOptions,
      @Res() errorResponse: TsoaResponse<400, ErrorResponse>,
  ): Promise<GraphWithViolations> {
    try {
      const {
        violations,
        graph,
      } = await new VisualizationService().getGraphFromSelectedNode(params);
      return {
        graph: ElementParserService.toGraph(graph),
        violations,
      };
    } catch (e: any) {
      if (e.name === 'Neo4jError' && e.code === 'Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration') {
        this.setStatus(400);
        errorResponse(400, { message: 'Query is too big to finish in 5 seconds' });
      }
      throw e;
    }
  }
}
