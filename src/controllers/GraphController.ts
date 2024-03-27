import {
  Body, Controller, Get, Post, Queries, Query, Res, Response, Route, Tags,
} from 'tsoa';
import { TsoaResponse } from '@tsoa/runtime';
import VisualizationService, { BaseQueryOptions, QueryOptions } from '../services/VisualizationService';
import { GraphWithViolations } from '../entities/Graph';
import ElementParserService from '../services/processing/ElementParserService';
import BreadcrumbService from '../services/BreadcrumbService';

interface ErrorResponse {
  message: string;
}

@Route('graph')
@Tags('Graph')
export class GraphController extends Controller {
  @Get('nodes')
  @Response<ErrorResponse>(400, 'Invalid query')
  public async getNodes(
  @Res() errorResponse: TsoaResponse<400, ErrorResponse>,
    @Query() name: string = '',
  ) {
    try {
      return await new VisualizationService().findNode(name);
    } catch (e: any) {
      if (e.name === 'Neo4jError' && e.code === 'Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration') {
        this.setStatus(400);
        errorResponse(400, { message: `Query is too big to finish in ${process.env.NEO4J_QUERY_TIMEOUT}ms` });
      }
      throw e;
    }
  }

  @Get('nodes/{id}')
  @Response<ErrorResponse>(400, 'Invalid query')
  public async getNode(
    id: string,
    @Queries() params: QueryOptions,
    @Res() errorResponse: TsoaResponse<400, ErrorResponse>,
  ): Promise<GraphWithViolations> {
    try {
      const {
        violations,
        graph,
      } = await new VisualizationService().getGraphFromSelectedNode(id, params);
      return {
        graph: ElementParserService.toGraph(graph),
        violations,
      };
    } catch (e: any) {
      if (e.name === 'Neo4jError' && e.code === 'Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration') {
        this.setStatus(400);
        errorResponse(400, { message: `Query is too big to finish in ${process.env.NEO4J_QUERY_TIMEOUT}ms` });
      }
      throw e;
    }
  }

  @Get('nodes/{id}/breadcrumbs')
  @Response<ErrorResponse>(400, 'Invalid query')
  public async getBreadcrumbOptions(
    id: string,
    @Queries() { layerDepth }: BaseQueryOptions,
    @Res() errorResponse: TsoaResponse<400, ErrorResponse>,
  ) {
    try {
      return await new BreadcrumbService().getBreadcrumbsFromSelectedNode(id, layerDepth);
    } catch (e: any) {
      if (e.name === 'Neo4jError' && e.code === 'Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration') {
        this.setStatus(400);
        errorResponse(400, { message: `Query is too big to finish in ${process.env.NEO4J_QUERY_TIMEOUT}ms` });
      }
      throw e;
    }
  }
}
