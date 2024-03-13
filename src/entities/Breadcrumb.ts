import { NodeData } from './Node';

export interface BreadcrumbItem {
  name: string;
  layerLabel: string;
  id: string;
}

export interface Breadcrumb extends BreadcrumbItem {
  options: NodeData[];
}
