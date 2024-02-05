import {
  Controller, Get, Route, Tags,
} from 'tsoa';
import GraphPropertiesService from '../services/GraphPropertiesService';

@Route('graph')
@Tags('Graph')
export class PropertiesController extends Controller {
  @Get('domains')
  public async getDomains() {
    return new GraphPropertiesService().getDomains();
  }

  @Get('layers')
  public async getLayers() {
    return new GraphPropertiesService().getLayers();
  }
}
