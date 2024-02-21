import { DependencyCycleRender } from './DependencyCycle';
import { LayerViolation } from './LayerViolation';

export { DependencyCycle } from './DependencyCycle';

export default interface Violations {
  dependencyCycles: DependencyCycleRender[];
  subLayers: LayerViolation[];
}
