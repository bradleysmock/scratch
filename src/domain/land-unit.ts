/**
 * Land units and holdings (spec §5.1).
 *
 * A `LandUnit` is one contiguous body of land under evaluation — a parcel today,
 * or a share produced by a subdivision scenario. A `Holding` is the set of units
 * a landowner is deciding about; most real farms are several parcels.
 *
 * Geometry is deliberately absent. Everything the viability model needs is a
 * scalar the ETL/PostGIS layer can produce from geometry, which keeps this layer
 * pure and testable and keeps the geometry decision (spec §7) reversible.
 */

import type { Basis, SourceRef } from './provenance.ts';
import type { SoilMapUnitObservation } from './soil.ts';

/** Reliability of water for an enterprise, ordered by increasing dependability. */
export const WATER_ACCESS_LEVELS = ['none', 'seasonal', 'year-round'] as const;
export type WaterAccessLevel = (typeof WATER_ACCESS_LEVELS)[number];
export type WaterAccess = WaterAccessLevel | 'unknown';

export function waterAccessRank(level: WaterAccessLevel): number {
  return WATER_ACCESS_LEVELS.indexOf(level);
}

export const FENCING_STATES = ['none', 'partial', 'perimeter'] as const;
export type FencingState = (typeof FENCING_STATES)[number] | 'unknown';

/** An acreage figure that knows how much weight it can carry. */
export interface AcreMeasure {
  readonly acres: number;
  readonly basis: Basis;
  /** Why the figure is what it is; surfaced verbatim in the brief. */
  readonly note?: string;
}

export function observedAcres(acres: number): AcreMeasure {
  return { acres, basis: 'observed' };
}

export interface LandUnit {
  readonly id: string;
  readonly label: string;
  /** Total acres in the unit. */
  readonly acres: number;
  /** Largest contiguous block of land in the unit, any land cover. */
  readonly contiguousAcres: AcreMeasure;
  /**
   * Largest contiguous block of tillable land. `null` where unknown — the model
   * reports indeterminate rather than guessing.
   */
  readonly contiguousTillableAcres: AcreMeasure | null;
  readonly waterAccess: WaterAccess;
  readonly fencing: FencingState;
  readonly soils: readonly SoilMapUnitObservation[];
  /** Provenance for the soil observations, e.g. the SSURGO survey vintage. */
  readonly soilSource: SourceRef;
  /** Free-text caveats carried into the brief. */
  readonly notes: readonly string[];
}

export interface LandUnitInput {
  readonly id: string;
  readonly label: string;
  readonly acres: number;
  readonly contiguousAcres?: AcreMeasure;
  readonly contiguousTillableAcres?: AcreMeasure | null;
  readonly waterAccess?: WaterAccess;
  readonly fencing?: FencingState;
  readonly soils: readonly SoilMapUnitObservation[];
  readonly soilSource: SourceRef;
  readonly notes?: readonly string[];
}

/**
 * Builds a land unit, defaulting the contiguous-acre figure to the unit's total
 * acres: a single parcel is contiguous by definition. Subdivision overrides this
 * with an estimate, because a share of a parcel is not.
 */
export function landUnit(input: LandUnitInput): LandUnit {
  return {
    id: input.id,
    label: input.label,
    acres: input.acres,
    contiguousAcres: input.contiguousAcres ?? observedAcres(input.acres),
    contiguousTillableAcres: input.contiguousTillableAcres ?? null,
    waterAccess: input.waterAccess ?? 'unknown',
    fencing: input.fencing ?? 'unknown',
    soils: input.soils,
    soilSource: input.soilSource,
    notes: input.notes ?? [],
  };
}

export interface Holding {
  readonly id: string;
  readonly label: string;
  readonly units: readonly LandUnit[];
}

export function holdingAcres(holding: Holding): number {
  return holding.units.reduce((total, unit) => total + unit.acres, 0);
}
