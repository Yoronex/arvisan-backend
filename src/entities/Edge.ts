import { NodeData } from './Node';
import { DependencyType } from '../database/entities';

export interface Edge {
  data: EdgeData,
}

export interface EdgeViolations {
  subLayer: boolean;
  dependencyCycle: boolean;
}

export interface EdgeData {
  /** Unique edge identifier */
  id: string,
  /** Identifier of source node */
  source: string,
  /** Identifier of target node */
  target: string,
  /** Edge label */
  interaction: string,
  /** Custom properties */
  properties: {
    /** Edge reference key (from OutSystems) */
    referenceKeys: string[]
    /** Edge weight */
    weight: number,
    /** Whether this edge is some architectural violation */
    violations: EdgeViolations & { any: boolean },
    /** Type of reference used within OutSystems */
    referenceTypes: string[],
    /** Type of dependency */
    dependencyTypes: DependencyType[],
  },
}

export interface ExtendedEdgeData extends EdgeData {
  /** Source node object */
  sourceNode: NodeData,
  /** Target node object */
  targetNode: NodeData,
}
