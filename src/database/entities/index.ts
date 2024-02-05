import { Integer, Node as Neo4jNode, Relationship as Neo4jRelationship } from 'neo4j-driver';

export type Neo4jComponentNode = Neo4jNode<Integer, {
  color: string;
  depth: number;
  id: string;
  kind: string;
  simpleName: string;
}>;

export type Neo4jComponentDependency = Neo4jRelationship<Integer, {
  id: string;
}>;

export interface Neo4jComponentPath {
  source: Neo4jComponentNode;
  path: Neo4jComponentDependency[];
  target: Neo4jComponentNode;
}

export interface Neo4jComponentPathWithChunks {
  source: Neo4jComponentNode;
  chunks: Neo4jComponentDependency[][];
  target: Neo4jComponentNode;
}
