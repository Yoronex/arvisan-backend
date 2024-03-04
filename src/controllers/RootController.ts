import {
  Controller, Get, Route, Tags,
} from 'tsoa';
import { getVersion, GitCommitInfo } from '../version';

@Route('')
@Tags('Root')
export class RootController extends Controller {
  @Get('version')
  public getBackendVersion(): GitCommitInfo {
    return getVersion();
  }
}
