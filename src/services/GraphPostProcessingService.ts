import { Graph } from '../entities/Graph';
import { Edge } from '../entities/Edge';
import { Node } from '../entities/Node';

export default class GraphPostProcessingService {
  private readonly _graph: Graph;

  constructor(...graphs: Graph[]) {
    if (graphs.length === 1) {
      [this._graph] = graphs;
    } else {
      this._graph = this.mergeGraphs(...graphs);
    }

    this.validateGraph(this._graph);
  }

  public get graph() {
    return this._graph;
  }

  private filterDuplicateNodes(nodes: Node[]): Node[] {
    return nodes.filter((n, i, all) => i === all.findIndex((n2) => n2.data.id === n.data.id));
  }

  private filterDuplicateEdges(edges: Edge[]): Edge[] {
    return edges.filter((e, i, all) => i === all.findIndex((e2) => e2.data.id === e.data.id));
  }

  /**
   * Merge two or more graphs into a single graph. Take out any duplicate nodes or edges
   * @param graphs
   * @private
   */
  private mergeGraphs(...graphs: Graph[]): Graph {
    const nodes = graphs.map((g) => g.nodes).flat();
    const edges = graphs.map((g) => g.edges).flat();
    const graph = {
      name: `Merged graph of '${graphs.map((g) => g.name).join(', ')}'`,
      nodes: this.filterDuplicateNodes(nodes),
      edges: this.filterDuplicateEdges(edges),
    };
    this.validateGraph(graph);
    return graph;
  }

  /**
   * Given a graph with nodes and edges, validate that for each edge
   * its source and target node exists in the list of nodes.
   * @param graph
   * @throws Error One or more edges is missing its source and/or target node
   */
  public validateGraph(graph: Graph) {
    const nodeIds = graph.nodes.map((n) => n.data.id);
    const invalidEdges = graph.edges
      .map((e): Edge => ({
        data: {
          ...e.data,
          source: nodeIds.includes(e.data.source) ? '' : e.data.source,
          target: nodeIds.includes(e.data.target) ? '' : e.data.target,
        },
      }))
      .filter((e) => (e.data.source !== '' || e.data.target !== ''));
    if (invalidEdges.length === 0) return;
    const message = invalidEdges.map((e) => {
      if (e.data.source === '') {
        return `Edge '${e.data.id}': unknown target '${e.data.target}'`;
      }
      if (e.data.target === '') {
        return `Edge '${e.data.id}': unknown source '${e.data.source}'`;
      }
      return `Edge '${e.data.id}': unknown source '${e.data.source}' and target '${e.data.target}'`;
    });
    throw new Error(`Graph '${graph.name}' is invalid due to the following edges: ${message.join('; ')}`);
  }
}
