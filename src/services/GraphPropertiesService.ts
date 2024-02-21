import { Record } from 'neo4j-driver';
import { Neo4jClient } from '../database/Neo4jClient';
import GraphProcessingService from './processing/GraphProcessingService';
import { INeo4jComponentPath } from '../database/entities';
import { Domain } from '../entities';
import GraphPreProcessingService from './processing/GraphPreProcessingService';

export interface GraphLayer {
  label: string;
  classes: string[];
  parentLabel?: string;
}

export interface Neo4jLayerRecord {
  from: string[],
  to: string[],
}

export default class GraphPropertiesService {
  private readonly client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  private formatDomains(records: Record<INeo4jComponentPath>[]): Domain[] {
    const preprocessor = new GraphPreProcessingService(records, undefined, false);
    const { nodes, edges } = new GraphProcessingService(preprocessor).formatToLPG('All domains', {
      maxDepth: 0,
      selfEdges: true,
    });

    return nodes.map((node): Domain => ({
      ...node.data,
      nrDependencies: edges
        .filter((e) => e.data.source === node.data.id && e.data.target !== node.data.id)
        .reduce((total, e) => total + e.data.properties.weight, 0),
      nrDependents: edges
        .filter((e) => e.data.source !== node.data.id && e.data.target === node.data.id)
        .reduce((total, e) => total + e.data.properties.weight, 0),
      nrInternalDependencies: edges
        .filter((e) => e.data.source === node.data.id && e.data.target === node.data.id)
        .reduce((total, e) => total + e.data.properties.weight, 0),
    }));
  }

  /**
   * Get a list of all domains with their corresponding node properties
   */
  async getDomains() {
    const query = `
            MATCH (selectedNode:Domain)-[r1:CONTAINS*0..5]->(moduleOrLayer)-[r2*1..1]->(dependency:Module)   // Get all modules that belong to the selected node
            MATCH (selectedNode)<-[:CONTAINS*0..5]-(selectedDomain:Domain)                                   // Get the domain of the selected node
            MATCH (dependency)<-[r3:CONTAINS*0..5]-(parent)                                                  // Get the layers, application and domain of all dependencies
            RETURN DISTINCT selectedNode as source, r1 + r2 + reverse(r3) as path, parent as target `;
    const records = await this.client
      .executeQuery<INeo4jComponentPath>(query);
    const domains = this.formatDomains(records);
    await this.client.destroy();
    return domains;
  }

  private formatLayers(records: Record<Neo4jLayerRecord>[]): GraphLayer[] {
    const layers: GraphLayer[] = [];

    const findOrCreateLayer = (label: string) => {
      let layer = layers.find((l) => l.label === label);
      if (!layer) {
        layer = { label, classes: [] };
        layers.push(layer);
      }
      return layer;
    };

    records.forEach((r) => {
      const [fromLabel, ...fromClasses] = r.get('from')[0].split('_');
      const [toLabel, ...toClasses] = r.get('to')[0].split('_');
      const fromLayer = findOrCreateLayer(fromLabel);
      const toLayer = findOrCreateLayer(toLabel);

      if (toLayer.parentLabel !== fromLabel) {
        toLayer.parentLabel = fromLabel;
      }

      fromClasses.forEach((c) => {
        if (!fromLayer.classes.includes(c)) fromLayer.classes.push(c);
      });
      toClasses.forEach((c) => {
        if (!toLayer.classes.includes(c)) toLayer.classes.push(c);
      });
    });

    return layers.sort((a, b) => {
      if (a.parentLabel === b.label) return -1;
      if (b.parentLabel === a.label) return 1;
      return 0;
    }).reverse();
  }

  async getLayers() {
    const query = 'MATCH (n)-[r:CONTAINS]->(m) RETURN distinct labels(n) as from, labels(m) as to';
    const records = await this.client.executeQuery<Neo4jLayerRecord>(query);
    const layers = this.formatLayers(records);
    await this.client.destroy();
    return layers;
  }
}
