import { Controller, Get, Route } from 'tsoa';

@Route('/graph')
export class GraphController extends Controller {
  @Get('')
  public getGraph() {
    this.setStatus(204);
  }
}
