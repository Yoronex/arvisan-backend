import { Node } from './Node';
import { Edge } from './Edge';

export class MapSet<T extends Node | Edge> extends Map<string, T> {
  constructor(...sets: MapSet<T>[]) {
    super();

    sets.forEach((nodes) => {
      nodes.forEach((value, key) => {
        if (this.has(key)) return;
        this.set(key, value);
      });
    });
  }

  /**
   * Create a nodeset from a list of nodes
   * @param elements
   */
  static from<T extends Node | Edge>(...elements: T[]): MapSet<T> {
    const set = new MapSet<T>();
    elements.forEach((node) => {
      set.set(node.data.id, node);
    });
    return set;
  }

  /**
   * @inheritDoc
   */
  get(key: string | undefined): T | undefined {
    if (key === undefined) return undefined;
    return super.get(key);
  }

  add(element: T): MapSet<T> {
    this.set(element.data.id, element);
    return this;
  }

  /**
   * Merge one or more nodeSets with this nodeSet into a new set
   * @param sets
   */
  concat(...sets: MapSet<T>[]): MapSet<T> {
    return new MapSet(this, ...sets);
  }

  /**
   * Return a copy of this MapSet, but only with the elements that have the given keys
   * @param ids
   */
  filterByKeys(ids: string[]): MapSet<T> {
    const newMapSet = new MapSet<T>();
    this.forEach((value, key) => {
      if (ids.includes(key)) newMapSet.set(key, value);
    });
    return newMapSet;
  }

  /**
   * Return a copy of this MapSet, but only with the entries that satisfy the given boolean function
   * @param callbackfn
   */
  filter(callbackfn: (value: T, key: string, map: Map<string, T>) => boolean): MapSet<T> {
    const result = new MapSet<T>();
    this.forEach((value, key, map) => {
      if (callbackfn(value, key, map)) {
        result.set(key, value);
      }
    });
    return result;
  }

  map<G>(callbackfn: (value: T, key: string, map: Map<string, T>) => G): G[] {
    const results: G[] = [];
    this.forEach((value, key, map) => {
      results.push(callbackfn(value, key, map));
    });
    return results;
  }

  reduce<U>(
    callbackfn: (previousValue: U, currentValue: T, currentKey?: string) => U,
    initialVal: U,
  ): U {
    let accumulator = initialVal;
    this.forEach((value, key) => {
      accumulator = callbackfn(accumulator, value, key);
    });
    return accumulator;
  }

  find(callbackfn: (value: T, key: string, map: Map<string, T>) => boolean): T | undefined {
    let result: T | undefined;
    this.forEach((value, key, map) => {
      if (result !== undefined) return;
      const found = callbackfn(value, key, map);
      if (found) result = value;
    });
    return result;
  }
}
