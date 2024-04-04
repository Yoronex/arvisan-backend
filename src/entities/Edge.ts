import { NodeData } from './Node';
import { DependencyType } from '../database/entities';

export interface Edge {
  data: EdgeData,
}

export interface EdgeViolations {
  subLayer: boolean;
  dependencyCycle: boolean;
}

export interface EdgeReferences {
  /** Type of reference used within OutSystems
   * (e.g. Action, Entity, Integration, WebBlock, etc.)  */
  type: string;
  /** Names of the actual references in OutSystems */
  names: string[],
}

export interface EdgeDataProperties {
  /** Whether this edge is some architectural violation */
  violations: EdgeViolations & { any: boolean };
  /** Actual references in OutSystems */
  references: EdgeReferences[];
  /** Type of dependency */
  dependencyTypes: DependencyType[];
  /** How many module-level dependencies exist within the source and target node */
  nrModuleDependencies: number;
  /** How many actual, function-level dependencies exist within the source and target node */
  nrFunctionDependencies: number;
  /** How many times the "weak" relationships are called in the
   * database-inserted timeframe. Undefined if no weak relationship */
  nrCalls?: number;
}

/**
 * Edge data which excludes any graph properties
 */
export interface SimpleEdgeData {
  /** Unique edge identifier */
  id: string,
  /** Identifier of source node */
  source: string,
  /** Identifier of target node */
  target: string,
  /** Edge label */
  interaction: string,
}
export interface EdgeData extends SimpleEdgeData {
  /** Custom properties */
  properties: EdgeDataProperties,
}

/**
 * Edge data without graph properties, but which explicit
 * details about source and target nodes
 */
export interface ExtendedSimpleEdgeData extends SimpleEdgeData {
  /** Source node object */
  sourceNode: NodeData,
  /** Target node object */
  targetNode: NodeData,
}
