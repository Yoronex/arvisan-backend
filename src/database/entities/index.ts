import { Integer, Node as Neo4jNode, Relationship as Neo4jRelationship } from 'neo4j-driver';

export enum DependencyType {
  STRONG = 'strong',
  WEAK = 'weak',
  ENTITY = 'entity',
}

export type INeo4jComponentNode = Neo4jNode<Integer, {
  color: string;
  depth: number;
  id: string;
  layerName: string;
  simpleName: string;
  fullName: string;
}>;

export type INeo4jRelationshipProperties = {
  id: string;
  referenceType: string;
  dependencyType?: DependencyType;
};

export type INeo4jComponentRelationship = Neo4jRelationship<Integer, INeo4jRelationshipProperties>;

export interface INeo4jComponentPath {
  source: INeo4jComponentNode;
  path: INeo4jComponentRelationship[];
  target: INeo4jComponentNode;
}
