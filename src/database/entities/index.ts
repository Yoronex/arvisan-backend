import { Integer, Node as Neo4jNode, Relationship as Neo4jRelationship } from 'neo4j-driver';

export enum ModuleDependencyProfileCategory {
  HIDDEN = 'hidden',
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  TRANSIT = 'transit',
}

export enum DependencyType {
  COMPILE_TIME = 'compile_time',
  RUNTIME = 'runtime',
  ENTITY = 'entity',
}

export type INeo4jNodeProperties = {
  color: string;
  depth: number;
  id: string;
  simpleName: string;
  fullName: string;
  dependencyProfileCategory?: ModuleDependencyProfileCategory;
  cohesion?: number;

  // (Aggregated) module details
  fileSizeKB?: number;
  nrScreens?: number;
  nrEntities?: number;
  nrPublicElements?: number;
  nrRESTConsumers?: number;
  nrRESTProducers?: number;
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
