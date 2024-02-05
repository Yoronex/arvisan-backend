import { NodeData } from './Node';

export interface Domain extends NodeData {
  nrDependencies: number;
  nrDependents: number;
  nrInternalDependencies: number;
}
