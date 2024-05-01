import {
  Controller, FormField, Post, Produces, Request, Res, Response, Route, Tags, UploadedFiles,
} from 'tsoa';
import express from 'express';
import { TsoaResponse } from '@tsoa/runtime';
import parseGraph from 'arvisan-input-parser/src/parser';
import { getCsvNodes, getCsvEdges } from 'arvisan-input-parser/src/csv';
import multer from 'multer';
import archiver from 'archiver';
import ErrorResponse from './responses/ErrorResponse';

@Route('graph/import')
@Tags('Graph')
export class ImportController extends Controller {
  @Post('parse')
  @Response<ErrorResponse>(501, 'Graph importing disabled')
  @Produces('application/zip')
  public async importGraph(
    @Request() request: express.Request,
      @Res() errorResponse: TsoaResponse<501, ErrorResponse>,
      @UploadedFiles() structureFiles?: Express.Multer.File[],
      @UploadedFiles() dependencyFiles?: Express.Multer.File[],
      @UploadedFiles() detailsFiles?: Express.Multer.File[],
      @UploadedFiles() integrationFiles?: Express.Multer.File[],
      @FormField() includeModuleLayerLayer?: string,
      @FormField() anonymize?: string,
  ): Promise<void> {
    if (!process.env.GRAPH_IMPORT_LOCATION) {
      this.setStatus(501);
      errorResponse(501, { message: 'Graph importing is disabled. If you wish to use this feature, enable it in the environment variables.' });
      return;
    }
    if (!parseGraph || !getCsvNodes || !getCsvEdges || !multer) {
      this.setStatus(501);
      errorResponse(501, { message: 'Graph importing is enabled, but some dependencies are missing. Make sure you have all optional dependencies installed.' });
      return;
    }

    const { res } = request;
    if (!res) throw new Error('express.Response not found.');

    const graph = parseGraph(
      structureFiles?.map((f) => f.buffer),
      dependencyFiles?.map((f) => f.buffer),
      integrationFiles?.map((f) => f.buffer),
      detailsFiles?.map((f) => f.buffer),
      includeModuleLayerLayer === 'true',
      anonymize === 'true',
    );

    const nodesFileName = 'nodes.csv';
    const edgesFileName = 'relationships.csv';
    const outputFileName = 'output.zip';

    const nodesBuffer = getCsvNodes(graph.elements.nodes);
    const edgesBuffer = getCsvEdges(graph.elements.edges);

    await new Promise<void>((resolve, reject) => {
      const archive = archiver('zip');

      archive.on('close', () => {
        res.send();
        resolve();
      });

      archive.on('error', (e) => {
        console.error(e);
        reject(e);
      });

      res.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);
      res.setHeader('Content-Type', 'application/zip');
      res.attachment(outputFileName);
      archive.pipe(res);

      archive.append(nodesBuffer, { name: nodesFileName });
      archive.append(edgesBuffer, { name: edgesFileName });

      archive.finalize();
    });
  }
}
