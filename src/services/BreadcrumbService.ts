import { Neo4jClient } from '../database/Neo4jClient';
import { Breadcrumb, BreadcrumbItem } from '../entities/Breadcrumb';
import { INeo4jComponentNode, INeo4jComponentRelationship } from '../database/entities';
import { filterDuplicates } from '../helpers/array';
import ElementParserService from './processing/ElementParserService';
import { NodeData } from '../entities/Node';

export default class BreadcrumbService {
  private readonly client: Neo4jClient;

  constructor() {
    this.client = new Neo4jClient();
  }

  /**
   * Given a node ID, get its breadcrumb path with possible alternative options
   * for the parent breadcrumb. Top layer is not included and should be fetched
   * with a separate function (PropertiesService.getDomains());
   * @param id
   * @private
   */
  private async getBreadcrumbsParents(id: string): Promise<Breadcrumb[]> {
    const records = await this.client
      .executeQuery<{ parent: INeo4jComponentNode, option: INeo4jComponentNode }>(`
        MATCH (parent)-[:CONTAINS*1..4]->(selectedNode WHERE elementId(selectedNode) = '${id}')
        MATCH (parent)-[:CONTAINS]->(option)
        RETURN parent, option
      `);

    const breadcrumbParents = records.reduce((parents: BreadcrumbItem[], record) => {
      const parent = record.get('parent');
      if (parents.some((p) => p.id === parent.elementId)) {
        return parents;
      }
      const layerLabel = ElementParserService.getLongestLabel(parent.labels);
      parents.push({ layerLabel, name: parent.properties.simpleName, id: parent.elementId });
      return parents;
    }, [])
      // Reverse the ordering, because now the lowest layer is the first element
      // and the "Domain" layer is the last
      .reverse();

    const breadcrumbs: Breadcrumb[] = breadcrumbParents.map((p) => {
      const optionNodes = records.filter((r) => r.get('parent').elementId === p.id);
      const options: NodeData[] = optionNodes.map((n) => {
        const option = n.get('option');
        const [layer] = ElementParserService.extractLayer(option.labels);
        const nodeData = ElementParserService.toNodeData(option);
        return {
          ...nodeData,
          properties: {
            ...nodeData.properties,
            // Override the layer, because ElementParserService.toNodeData
            // always takes the longest label
            layer,
          },
        };
      }).sort((a, b) => {
        if (a.label > b.label) return 1;
        if (a.label < b.label) return -1;
        return 0;
      });
      return { ...p, options };
    });

    // The current label/id of the breadcrumbs are still the parents,
    // while they should be layer label and the current selected node ID of that layer.
    return breadcrumbs.map((breadcrumb, i, all): Breadcrumb => {
      const elementId = all[i + 1]?.id ?? id;
      const selectedOption = breadcrumb.options.find((o) => o.id === elementId)!;
      return {
        layerLabel: selectedOption.properties.layer,
        name: selectedOption.label,
        id: selectedOption.id,
        options: breadcrumb.options,
      };
    });
  }

  /**
   * Extra breadcrumbs to select a child of the selected (given) node
   * @param id
   * @param layerDepth
   */
  private async getBreadcrumbsChildren(id: string, layerDepth: number): Promise<Breadcrumb[]> {
    if (layerDepth <= 0) return [];

    const records = await this.client
      .executeQuery<{ path: INeo4jComponentRelationship[], child: INeo4jComponentNode }>(`
        MATCH (selectedNode WHERE elementId(selectedNode) = '${id}')-[path:CONTAINS*1..${layerDepth}]->(child)
        RETURN path, child
      `);

    const depths = [...Array(layerDepth).keys()];
    const groupedRecords = depths
      .map((d) => records.filter((r) => r.get('path').length === d + 1))
      .filter((group) => group.length > 0);

    return groupedRecords.map((group) => {
      const children = group.map((g) => g.get('child'));
      const childLabels = children.map((child) => child.labels).flat().filter(filterDuplicates);
      const [layerLabel] = ElementParserService.extractLayer(childLabels);
      const options: NodeData[] = children.map((c) => ElementParserService.toNodeData(c));
      return {
        layerLabel,
        options,
        name: `${layerLabel}s`,
      };
    });
  }

  /**
   * Get a list of the breadcrumbs of the selected node, including a list of possible other children
   * of the parent.
   * @param id
   * @param layerDepth
   */
  public async getBreadcrumbsFromSelectedNode(
    id: string,
    layerDepth: number,
  ): Promise<Breadcrumb[]> {
    const [parentBreadcrumbs, childBreadcrumbs] = await Promise.all([
      this.getBreadcrumbsParents(id),
      this.getBreadcrumbsChildren(id, layerDepth),
    ]);
    return parentBreadcrumbs.concat(childBreadcrumbs);
  }
}
