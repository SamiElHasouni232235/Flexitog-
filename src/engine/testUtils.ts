import { seedWorkspace } from '../data/seed';
import { resolveAssumptions } from './model';
import type { EngineInput } from './model';
import { resolveStores } from './stores';
import type { AssumptionValues, Workspace } from './types';

export function seedInput(ws: Workspace = seedWorkspace()): EngineInput {
  return {
    products: ws.products,
    dc: ws.dc,
    hubs: ws.hubs,
    stores: resolveStores(ws.storeSet, ws.hubs),
    assumptions: ws.assumptions,
  };
}

export function seedAssumptionValues(): AssumptionValues {
  return resolveAssumptions(seedWorkspace().assumptions);
}
