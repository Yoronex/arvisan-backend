export function filterDuplicates<T>(element: T, index: number, all: T[]): boolean {
  return index === all.findIndex((e) => element === e);
}
