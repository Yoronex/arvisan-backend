import { NodeData } from '../Node';
import { ExtendedEdgeData } from '../Edge';

export interface DependencyCycle {
  node: NodeData,
  path: ExtendedEdgeData[],
  length: number,
}

export interface DependencyCycleRender extends DependencyCycle {
  actualCycles: DependencyCycle[];
}
