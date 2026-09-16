export {
  SimEngine,
  ENGINE_VERSION,
  type EngineServiceSpec,
  type EngineWorldSpec,
  type EngineRunOptions,
  type EngineRunResult,
} from './sim-engine.js';
export {
  computeStateHash,
  computeStateHashRoot,
  compareStateHashes,
  type StateHashResult,
  type DivergenceReport,
} from './state-hash.js';
export {
  buildComponents,
  ServiceComponent,
  RngComponent,
  ClockComponent,
  HASH_SCHEMA_VERSION,
  type WorldStateSnapshot,
} from './world-state.js';
