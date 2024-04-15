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
    /** Layer this node is in */
    layer: string,
    /** Hex color this node should be */
    color: string,
    /** Whether this node is selected or not */
    selected: 'true' | 'false',

    /** The type of dependency profile this node is. Only for bottom-layer nodes */
    dependencyProfileCategory?: ModuleDependencyProfileCategory;
    /**
     * Dependency profile of the given node. Quadruple of four categories
     * [hidden, inbound, outbound, transit] if internal (tree) node. Undefined if leaf node.
     */
    dependencyProfile: number[];
    /** Cohesion metric of leaves within this node */
    cohesion?: number;

    // (Aggregated) module details, directly from DB
    fileSizeKB?: number;
    nrScreens?: number;
    nrEntities?: number;
    nrPublicElements?: number;
    nrRESTConsumers?: number;
    nrRESTProducers?: number;

    /**
     * How many lowest-layer nodes are contained in this node.
     * 1 if node itself is a leaf.
     * Undefined if it cannot be calculated
     */
    nrLeaves?: number;
  },
}
