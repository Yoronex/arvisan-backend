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
    /**
     * Edge reference key (from OutSystems)
     * @deprecated information is irrelevant for end user
     */
    referenceKeys: string[]
    /**
     * Weight of the edge
     * @deprecated Edge weight. The number of dependencies received their own attribute.
     */
    weight: number,
    /** Whether this edge is some architectural violation */
    violations: EdgeViolations & { any: boolean },
    /** Names of the actual references in OutSystems */
    referenceNames: string[],
    /** Type of reference used within OutSystems
     * (e.g. Action, Entity, Integration, WebBlock, etc.)  */
    referenceTypes: string[],
    /** Type of dependency */
    dependencyTypes: DependencyType[],
    /** How many module-level dependencies exist within the source and target node */
    nrModuleDependencies: number,
    /** How many actual, function-level dependencies exist within the source and target node */
    nrFunctionDependencies: number,
    /** How many times the "weak" relationships are called in the
     * database-inserted timeframe. Undefined if no weak relationship */
    nrCalls?: number,
  },
}

export interface ExtendedEdgeData extends EdgeData {
  /** Source node object */
  sourceNode: NodeData,
  /** Target node object */
  targetNode: NodeData,
}
