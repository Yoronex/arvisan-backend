import * as fs from 'fs';
import { execSync } from 'node:child_process';

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  date: Date;
  tags: string[];
}

function getVersionFromGit(): GitCommitInfo {
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

export function getVersion(): GitCommitInfo {
  if (fs.existsSync('./version.json')) {
    return JSON.parse(fs.readFileSync('./version.json', 'utf-8'));
  }
  return getVersionFromGit();
}

export function cacheVersion(): void {
  const version = JSON.stringify(getVersionFromGit());
  fs.writeFileSync('./version.json', version, 'utf-8');
}

if (['-s', '--save'].includes(process.argv[2])) {
  cacheVersion();
}
