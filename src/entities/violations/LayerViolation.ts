import { EdgeData } from '../Edge';

export interface LayerViolationSpec {
  fromSublayer: string;
  toSublayer: string;
}

export interface LayerViolation extends EdgeData {
  actualEdges: EdgeData[]; // List, because an abstraction may include multiple "real" edges
}
