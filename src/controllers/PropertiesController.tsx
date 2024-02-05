import {
  Controller, Get, Route, Tags,
} from 'tsoa';
import GraphPropertiesService from '../services/GraphPropertiesService';

@Route('graph')
@Tags('graph')
export class GraphController extends Controller {
  @Get('domains')
  public async getDomains() {
    return new GraphPropertiesService().getDomains();
  }
}
