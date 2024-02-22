import { ExtendedEdgeData } from '../Edge';

export interface LayerViolationSpec {
  fromSublayer: string;
  toSublayer: string;
}

export interface LayerViolation extends ExtendedEdgeData {
  actualEdges: ExtendedEdgeData[]; // List, because an abstraction may include multiple "real" edges
}
