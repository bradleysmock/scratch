/**
 * Test fixtures.
 *
 * The map units below are fictional: the symbols and names do not correspond to
 * any published soil survey, and are shaped only to exercise the model. Real
 * verification happens against ground the owner knows (spec §8, Phase 1), not
 * against invented soils.
 */

import { loadThresholdCatalog } from '../data/catalog.ts';
import { landUnit, observedAcres, type Holding, type LandUnit } from '../domain/land-unit.ts';
import type { SourceRef } from '../domain/provenance.ts';
import type { SoilMapUnitObservation } from '../domain/soil.ts';

export const FIXTURE_SOIL_SOURCE: SourceRef = {
  dataset: 'Fictional soil survey (test fixture)',
  vintage: '2026',
  retrieved: '2026-09-01',
  reference: 'Not a real survey area',
};

export const WELL_DRAINED_LOAM: SoilMapUnitObservation = {
  mapUnitSymbol: 'FX-1',
  mapUnitName: 'Fixture loam, 0 to 4 percent slopes',
  acres: 120,
  slopePercent: 3,
  drainageClass: 'well drained',
  nccpi: 0.6,
  hydric: false,
  farmlandClass: 'prime',
};

export const SOMEWHAT_POORLY_SILT: SoilMapUnitObservation = {
  mapUnitSymbol: 'FX-2',
  mapUnitName: 'Fixture silt loam, 0 to 2 percent slopes',
  acres: 30,
  slopePercent: 2,
  drainageClass: 'somewhat poorly drained',
  nccpi: 0.45,
  hydric: false,
  farmlandClass: 'prime-if-drained',
};

export const HYDRIC_MUCK: SoilMapUnitObservation = {
  mapUnitSymbol: 'FX-3',
  mapUnitName: 'Fixture muck, 0 to 1 percent slopes',
  acres: 20,
  slopePercent: 1,
  drainageClass: 'very poorly drained',
  nccpi: null,
  hydric: true,
  farmlandClass: 'not-prime',
};

export const STEEP_SAND: SoilMapUnitObservation = {
  mapUnitSymbol: 'FX-4',
  mapUnitName: 'Fixture sandy loam, 12 to 25 percent slopes',
  acres: 10,
  slopePercent: 18,
  drainageClass: 'somewhat excessively drained',
  nccpi: 0.2,
  hydric: false,
  farmlandClass: 'not-prime',
};

export const FIXTURE_SOILS: readonly SoilMapUnitObservation[] = [
  WELL_DRAINED_LOAM,
  SOMEWHAT_POORLY_SILT,
  HYDRIC_MUCK,
  STEEP_SAND,
];

/** 180 acres, 150 of them contiguous and tillable. */
export function homeFarm(overrides: Partial<Parameters<typeof landUnit>[0]> = {}): LandUnit {
  return landUnit({
    id: 'home-farm',
    label: 'Home farm',
    acres: 180,
    contiguousTillableAcres: observedAcres(150),
    waterAccess: 'year-round',
    fencing: 'none',
    soils: FIXTURE_SOILS,
    soilSource: FIXTURE_SOIL_SOURCE,
    ...overrides,
  });
}

export function homeFarmHolding(): Holding {
  return { id: 'fixture-holding', label: 'Fixture holding', units: [homeFarm()] };
}

export const FIXTURE_CATALOG = loadThresholdCatalog();
