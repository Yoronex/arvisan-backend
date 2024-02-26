import { NodeData } from './Node';

export interface Domain extends NodeData {
  nrOutgoingDependencies: number;
  nrIncomingDependencies: number;
  nrInternalDependencies: number;
}
