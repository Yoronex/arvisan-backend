import { ExtendedSimpleEdgeData } from '../Edge';

export interface LayerViolationSpec {
  fromSublayer: string;
  toSublayer: string;
}

export interface LayerViolation extends ExtendedSimpleEdgeData {
  // List, because an abstraction may include multiple "real" edges
  actualEdges: ExtendedSimpleEdgeData[];
}
