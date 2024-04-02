import { NodeData } from '../Node';
import { ExtendedSimpleEdgeData } from '../Edge';

export interface DependencyCycle {
  node: NodeData,
  path: ExtendedSimpleEdgeData[],
  length: number,
}

export interface DependencyCycleRender extends DependencyCycle {
  actualCycles: DependencyCycle[];
  id: string;
}
