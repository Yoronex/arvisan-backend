import {
  Controller, FormField, Get, Post, Produces, Res, Response, Route, Tags,
  UploadedFile, UploadedFiles,
} from 'tsoa';
import { TsoaResponse } from '@tsoa/runtime';
import parseGraph from 'arvisan-input-parser/src/parser';
import { getCsvNodes, getCsvEdges } from 'arvisan-input-parser/src/csv';
import { validateGraph } from 'arvisan-input-parser/src/graph';
import { injectGraphCypher } from 'arvisan-input-parser/src/neo4j-inject';
import multer from 'multer';
import archiver from 'archiver';
import * as fs from 'fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import ErrorResponse from './responses/ErrorResponse';

@Route('graph/import')
@Tags('Graph')
export class ImportController extends Controller {
  /**
   * Returns whether the graph parse and import endpoints are enabled, i.e.
   * whether the preconditions for the graph import controller are met.
   */
  @Get()
  public canUseGraphImport(): boolean {
    return !!process.env.GRAPH_IMPORT_LOCATION
      && !!parseGraph && !!getCsvNodes && !!getCsvEdges && !!multer && !!archiver;
  }

  /**
   * Given a set of input files, get a .zip file containing a set of nodes and a set of edges.
   * Note that this endpoint may take several minutes to complete.
   * @param disabledResponse
   * @param validationErrorResponse
   * @param structureFiles Files containing the structure of the landscape
   * (domains, applications, sublayers, and modules).
   * @param dependencyFiles Files containing consumers and producers.
   * @param integrationFiles Files containing dynamic data about integrations and service APIs.
   * @param detailsFiles Files containing more details about modules.
   * @param includeModuleLayerLayer Whether the "Layer" layer from the OutSystems Architecture
   * Canvas should be included in the resulting graph
   * @param anonymize Whether the output graph should be anonymized
   */
  @Post('parse')
  @Response<ErrorResponse>(501, 'Graph importing disabled')
  @Produces('application/zip')
  public async parseGraph(
    @Res() disabledResponse: TsoaResponse<501, ErrorResponse>,
      @Res() validationErrorResponse: TsoaResponse<400, ErrorResponse>,
      @UploadedFiles() structureFiles?: Express.Multer.File[],
      @UploadedFiles() dependencyFiles?: Express.Multer.File[],
      @UploadedFiles() detailsFiles?: Express.Multer.File[],
      @UploadedFiles() integrationFiles?: Express.Multer.File[],
      @FormField() includeModuleLayerLayer?: string,
      @FormField() anonymize?: string,
  ): Promise<Readable> {
    if (!process.env.GRAPH_IMPORT_LOCATION) {
      this.setStatus(501);
      return disabledResponse(501, { message: 'Graph importing is disabled. If you wish to use this feature, enable it in the environment variables.' });
    }
    if (!parseGraph || !getCsvNodes || !getCsvEdges || !multer || !archiver || !validateGraph) {
      this.setStatus(501);
      return disabledResponse(501, { message: 'Graph importing is enabled, but some dependencies are missing. Make sure you have all optional dependencies installed.' });
    }

    const graph = parseGraph(
      structureFiles?.map((f) => f.buffer),
      dependencyFiles?.map((f) => f.buffer),
      integrationFiles?.map((f) => f.buffer),
      detailsFiles?.map((f) => f.buffer),
      includeModuleLayerLayer === 'true',
      anonymize === 'true',
    );

    try {
      validateGraph(graph, detailsFiles && detailsFiles.length > 0);
    } catch (e: any) {
      validationErrorResponse(400, { message: `Graph validation failed. ${e.message}` });
    }

    const nodesFileName = 'nodes.csv';
    const edgesFileName = 'relationships.csv';
    const outputFileName = 'output.zip';

    const nodesBuffer = getCsvNodes(graph.elements.nodes);
    const edgesBuffer = getCsvEdges(graph.elements.edges);

    const buffers: Buffer[] = [];

    const zip = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip');

      archive.on('data', (d) => buffers.push(d));
      archive.on('close', () => {
        resolve(Buffer.concat(buffers));
      });
      archive.on('error', (e) => {
        console.error(e);
        reject(e);
      });

      archive.append(nodesBuffer, { name: nodesFileName });
      archive.append(edgesBuffer, { name: edgesFileName });

      archive.finalize();
    });

    this.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);
    this.setHeader('Content-Type', 'application/zip');
    return Readable.from(zip);
  }

  /**
   * Drop the existing database and seed it with the provided set of nodes and edges.
   * Note that this endpoint may take several minutes to complete.
   * @param errorResponse
   * @param nodes Set of nodes
   * @param relationships Set of edges
   */
  @Post('import')
  @Response<ErrorResponse>(501, 'Graph importing disabled')
  public async importGraph(
    @Res() errorResponse: TsoaResponse<501, ErrorResponse>,
      @UploadedFile() nodes: Express.Multer.File,
      @UploadedFile() relationships: Express.Multer.File,
  ): Promise<void> {
    if (!process.env.GRAPH_IMPORT_LOCATION) {
      this.setStatus(501);
      errorResponse(501, { message: 'Graph importing is disabled. If you wish to use this feature, enable it in the environment variables.' });
      return;
    }
    if (!injectGraphCypher) {
      this.setStatus(501);
      errorResponse(501, { message: 'Graph importing is enabled, but some dependencies are missing. Make sure you have all optional dependencies installed.' });
    }

    fs.writeFileSync(path.join(process.env.GRAPH_IMPORT_LOCATION, 'nodes.csv'), nodes.buffer);
    fs.writeFileSync(path.join(process.env.GRAPH_IMPORT_LOCATION, 'relationships.csv'), relationships.buffer);

    await injectGraphCypher(process.env.NEO4J_PASSWORD ?? '', process.env.NEO4J_DATABASE, process.env.NEO4J_URL);
  }
}
