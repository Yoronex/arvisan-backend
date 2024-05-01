import {
  Controller, FormField, Post, Request, Res, Response, Route, Tags, UploadedFiles,
} from 'tsoa';
import express from 'express';
import { TsoaResponse } from '@tsoa/runtime';
import parseGraph from 'arvisan-input-parser/src/parser';
import { writeEdgesToDisk, writeNodesToDisk } from 'arvisan-input-parser/src/csv';
import multer from 'multer';
import fs from 'fs';
import archiver from 'archiver';
import ErrorResponse from './responses/ErrorResponse';

@Route('graph/import')
@Tags('Graph')
export class ImportController extends Controller {
  @Post('parse')
  @Response<ErrorResponse>(501, 'Graph importing disabled')
  public async importGraph(
    @Request() request: express.Request,
      @Res() errorResponse: TsoaResponse<501, ErrorResponse>,
      @UploadedFiles() structureFiles?: Express.Multer.File[],
      @UploadedFiles() dependencyFiles?: Express.Multer.File[],
      @UploadedFiles() detailsFiles?: Express.Multer.File[],
      @UploadedFiles() integrationFiles?: Express.Multer.File[],
      @FormField() includeModuleLayerLayer?: string,
      @FormField() anonymize?: string,
  ): Promise<any> {
    if (!process.env.GRAPH_IMPORT_LOCATION) {
      this.setStatus(501);
      errorResponse(501, { message: 'Graph importing is disabled. If you wish to use this feature, enable it in the environment variables.' });
    } else if (!parseGraph || !writeNodesToDisk || !writeEdgesToDisk || !multer) {
      this.setStatus(501);
      errorResponse(501, { message: 'Graph importing is enabled, but some dependencies are missing. Make sure you have all optional dependencies installed.' });
    }

    const graph = parseGraph(
      structureFiles?.map((f) => f.buffer),
      dependencyFiles?.map((f) => f.buffer),
      integrationFiles?.map((f) => f.buffer),
      detailsFiles?.map((f) => f.buffer),
      includeModuleLayerLayer === 'true',
      anonymize === 'true',
    );

    writeNodesToDisk(graph.elements.nodes);
    writeEdgesToDisk(graph.elements.edges);

    const { res } = request;
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream('output.zip');
      const archive = archiver('zip');

      output.on('close', () => {
        res?.sendFile('output.zip', { root: process.cwd() }, (err) => {
          if (err) {
            console.error('Could not send file', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });

      output.on('error', (e) => {
        console.error(e);
        reject(e);
      });

      archive.pipe(output);

      archive.append('nodes.csv', { name: 'nodes.csv' });
      archive.append('edges.csv', { name: 'edges.csv' });

      archive.finalize();
    });

    return res;
  }
}
