import { Integer, Node as Neo4jNode, Relationship as Neo4jRelationship } from 'neo4j-driver';

export enum ModuleDependencyProfileCategory {
  HIDDEN = 'hidden',
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  TRANSIT = 'transit',
}

export enum DependencyType {
  STRONG = 'strong',
  WEAK = 'weak',
  ENTITY = 'entity',
}

export type INeo4jNodeProperties = {
  color: string;
  depth: number;
  id: string;
  simpleName: string;
  fullName: string;
  dependencyProfileCategory?: ModuleDependencyProfileCategory;
};

export type INeo4jComponentNode = Neo4jNode<Integer, INeo4jNodeProperties>;

export type INeo4jRelationshipProperties = {
  referenceType: string;
  dependencyType?: DependencyType;
  referenceNames: string;
  nrDependencies?: number;
  nrCalls?: number;
};

export type INeo4jComponentRelationship = Neo4jRelationship<Integer, INeo4jRelationshipProperties>;

export interface INeo4jComponentPath {
  source: INeo4jComponentNode;
  path: INeo4jComponentRelationship[];
  target: INeo4jComponentNode;
}

export interface Neo4jRelationshipMappings {
  sourceToTargets: Map<string, string[]>;
  targetToSource: Map<string, string>;
}
