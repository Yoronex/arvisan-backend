import { DependencyCycle, DependencyCycleRender } from './DependencyCycle';

export { DependencyCycle } from './DependencyCycle';

export default interface Violations {
  dependencyCycles: DependencyCycleRender[];
}
