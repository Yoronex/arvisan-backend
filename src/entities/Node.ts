import { ModuleDependencyProfileCategory } from '../database/entities';

export interface Node {
  data: NodeData,
}

export interface NodeData {
  /** Unique node identifier */
  id: string,
  /** Node label (name) */
  label: string,
  /** ID of the parent node (if it exists) */
  parent?: string;
  /** Custom properties of node */
  properties: {
    /** Full name of the node (including prefixes) */
    fullName: string,
    /** Type of node */
    kind: string,
    /** Layer this node is in */
    layer: string,
    /** Hex color this node should be */
    color: string,
    /** Node layer depth */
    depth: number,
    /** Whether this node is selected or not */
    selected: 'true' | 'false',
    /** The type of dependency profile this node is. Only for bottom-layer nodes */
    dependencyProfileCategory?: ModuleDependencyProfileCategory;
  },
}
