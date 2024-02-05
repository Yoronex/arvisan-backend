import {
  Controller, Get, Route, Tags,
} from 'tsoa';
import { execSync } from 'node:child_process';

interface GitCommitInfo {
  hash: string;
  shortHash: string;
  date: Date;
  tags: string[];
}

@Route('')
@Tags('Root')
export class RootController extends Controller {
  @Get('version')
  public getBackendVersion(): GitCommitInfo {
    const shortHash = execSync('git rev-parse --short HEAD').toString().trim();
    const lastCommit = execSync('git log -1').toString();
    const tags = execSync('git tag --contains HEAD').toString().trim().split(' ');
    const lastCommitLines = lastCommit.split('\n').map((l) => l.trim());

    const hash = lastCommitLines[0].split(' ')[1].trim();
    const dateLine = lastCommitLines.find((l) => l.includes('Date:')) || '';
    const date = new Date(dateLine.substring(dateLine.indexOf('Date:') + 1).trim());

    return {
      hash, shortHash, date, tags: tags.filter((t) => t.length > 0),
    };
  }
}
