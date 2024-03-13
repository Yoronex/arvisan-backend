export interface BreadcrumbOption {
  name: string;
  layerLabel: string;
  id: string;
}

export interface BreadcrumbLayer {
  layerLabel: string;
  id: string;
}

export interface Breadcrumb extends BreadcrumbLayer {
  options: BreadcrumbOption[];
}
