import { Integer, Node as Neo4jNode, Relationship as Neo4jRelationship } from 'neo4j-driver';

export type INeo4jComponentNode = Neo4jNode<Integer, {
  color: string;
  depth: number;
  id: string;
  kind: string;
  simpleName: string;
}>;

export type INeo4jComponentRelationship = Neo4jRelationship<Integer, {
  id: string;
}>;

export interface INeo4jComponentPath {
  source: INeo4jComponentNode;
  path: INeo4jComponentRelationship[];
  target: INeo4jComponentNode;
}
