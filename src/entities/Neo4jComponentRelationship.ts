import { Integer } from 'neo4j-driver';
import {
  INeo4jComponentRelationship,
  INeo4jRelationshipProperties,
  Neo4jRelationshipMappings,
} from '../database/entities';
import { Node } from './Node';
import { EdgeViolations } from './Edge';
import { MapSet } from './MapSet';
import Neo4jComponentNode from './Neo4jComponentNode';

export class Neo4jComponentRelationship implements INeo4jComponentRelationship {
  elementId: string;

  endNodeElementId: string;

  startNodeElementId: string;

  type: string;

  properties: INeo4jRelationshipProperties;

  violations: EdgeViolations = {
    subLayer: false,
    dependencyCycle: false,
  };

  identity: Integer;

  start: Integer;

  end: Integer;

  readonly originalRelationship: INeo4jComponentRelationship;

  readonly originalStartNode: Neo4jComponentNode;

  readonly originalEndNode: Neo4jComponentNode;

  /** Reference to the start node of this relationship */
  startNode: Neo4jComponentNode;

  /** Reference to the end node of this relationship */
  endNode: Neo4jComponentNode;

  constructor(
    dep: INeo4jComponentRelationship,
    nodes: MapSet<Neo4jComponentNode>,
  ) {
    this.elementId = dep.elementId;
    this.startNodeElementId = dep.startNodeElementId;
    this.endNodeElementId = dep.endNodeElementId;
    this.type = dep.type;
    this.properties = dep.properties;
    this.identity = dep.identity;
    this.start = dep.start;
    this.end = dep.end;
    this.originalRelationship = dep;

    const startNode = nodes.get(this.startNodeElementId);
    if (startNode == null) {
      throw new Error(`Start node (ID ${this.startNodeElementId}) for edge ${this.elementId} not found!`);
    }
    this.startNode = startNode;
    this.originalStartNode = startNode;

    const endNode = nodes.get(this.endNodeElementId);
    if (endNode == null) {
      throw new Error(`End node (ID ${this.endNodeElementId}) for edge ${this.elementId} not found!`);
    }
    this.endNode = endNode;
    this.originalEndNode = endNode;
  }

  setNodeReferences(nodes: MapSet<Neo4jComponentNode>) {
    if (!nodes.has(this.startNodeElementId)) {
      throw new Error(`Node with ID '${this.startNodeElementId}' not found.`);
    }
    this.startNode = nodes.get(this.startNodeElementId)!;

    if (!nodes.has(this.startNodeElementId)) {
      throw new Error(`Node with ID '${this.endNodeElementId}' not found.`);
    }
    this.endNode = nodes.get(this.endNodeElementId)!;
  }
}
