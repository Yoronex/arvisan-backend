import {
  Controller, Get, Route, Tags,
} from 'tsoa';
import PropertiesService from '../services/PropertiesService';

@Route('graph')
@Tags('Graph')
export class PropertiesController extends Controller {
  @Get('domains')
  public async getDomains() {
    return new PropertiesService().getDomains();
  }

  @Get('layers')
  public async getLayers() {
    return new PropertiesService().getLayers();
  }
}
