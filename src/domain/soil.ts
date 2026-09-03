/**
 * Soil characterization (spec §5.2).
 *
 * The domain takes SSURGO map-unit observations as *input*. Ingestion — the
 * spatial join of parcel geometry against SSURGO polygons — belongs to the ETL
 * and PostGIS layers (spec §7) and is deliberately absent here: this module is
 * pure, so it stays unit-testable with no database.
 */

import { derive, indeterminate, type Derived, type SourceRef } from './provenance.ts';

/**
 * NRCS natural drainage classes, wettest to driest. Order is meaningful: an
 * enterprise's drainage tolerance is a contiguous window over this sequence,
 * and "too wet" versus "too dry" is decided by position within it.
 */
export const DRAINAGE_CLASSES = [
  'very poorly drained',
  'poorly drained',
  'somewhat poorly drained',
  'moderately well drained',
  'well drained',
  'somewhat excessively drained',
  'excessively drained',
] as const;

export type DrainageClass = (typeof DRAINAGE_CLASSES)[number];

export function drainageRank(drainageClass: DrainageClass): number {
  return DRAINAGE_CLASSES.indexOf(drainageClass);
}

/**
 * NRCS farmland classification. `prime-if-drained` and `prime-if-protected` are
 * kept distinct from `prime` on purpose: NRCS counts them as prime only when the
 * condition is actually met, and an ACEP-ALE ranking percentage that silently
 * merges them overstates the parcel.
 */
export const FARMLAND_CLASSES = [
  'prime',
  'prime-if-drained',
  'prime-if-protected',
  'statewide-important',
  'unique',
  'not-prime',
] as const;

export type FarmlandClass = (typeof FARMLAND_CLASSES)[number];

/** One SSURGO map unit as it falls within a land unit's boundary. */
export interface SoilMapUnitObservation {
  readonly mapUnitSymbol: string;
  readonly mapUnitName: string;
  /** Acres of this map unit inside the land unit. */
  readonly acres: number;
  /** Representative slope for the map unit, percent. */
  readonly slopePercent: number;
  readonly drainageClass: DrainageClass;
  /**
   * National Commodity Crop Productivity Index, 0–1. `null` where SSURGO
   * carries no value (common for water, pits, and made land) — never coerced
   * to zero, which would read as "unproductive" rather than "unrated".
   */
  readonly nccpi: number | null;
  readonly hydric: boolean;
  readonly farmlandClass: FarmlandClass;
}

export interface SoilSummary {
  readonly mappedAcres: Derived<number>;
  /** Acres classified `prime` outright. */
  readonly primeAcres: Derived<number>;
  /** Acres prime only under a condition (drainage, flood protection). */
  readonly conditionallyPrimeAcres: Derived<number>;
  /** primeAcres / mappedAcres, percent. The ACEP-ALE ranking input (spec §5.2). */
  readonly primePercent: Derived<number>;
  /** Percent counting conditionally-prime acres, i.e. the optimistic reading. */
  readonly primeIncludingConditionalPercent: Derived<number>;
  readonly hydricAcres: Derived<number>;
  /** Acreage-weighted NCCPI over rated map units, or indeterminate. */
  readonly productivityIndex: Derived<number> | Derived<null>;
  /** Share of mapped acres carrying an NCCPI rating, 0–1. */
  readonly productivityCoverage: Derived<number>;
  /** Highest representative slope present, percent. */
  readonly maxSlopePercent: Derived<number> | Derived<null>;
  /** Acres by drainage class, wettest first; classes with no acres omitted. */
  readonly drainageComposition: Derived<readonly DrainageAcres[]>;
}

export interface DrainageAcres {
  readonly drainageClass: DrainageClass;
  readonly acres: number;
}

/**
 * Below this share of rated acres, an acreage-weighted productivity index
 * describes too little of the parcel to stand behind, and the summary reports
 * indeterminate instead. Threshold is a modelling choice, not an NRCS rule.
 */
export const MIN_PRODUCTIVITY_COVERAGE = 0.5;

export function summarizeSoils(
  observations: readonly SoilMapUnitObservation[],
  source: SourceRef,
): SoilSummary {
  const sources = [source];
  const mappedAcres = sum(observations.map((o) => o.acres));

  const primeAcres = sum(
    observations.filter((o) => o.farmlandClass === 'prime').map((o) => o.acres),
  );
  const conditionallyPrimeAcres = sum(
    observations
      .filter((o) => o.farmlandClass === 'prime-if-drained' || o.farmlandClass === 'prime-if-protected')
      .map((o) => o.acres),
  );
  const hydricAcres = sum(observations.filter((o) => o.hydric).map((o) => o.acres));

  const rated = observations.filter((o) => o.nccpi !== null);
  const ratedAcres = sum(rated.map((o) => o.acres));
  const coverage = mappedAcres > 0 ? ratedAcres / mappedAcres : 0;

  return {
    mappedAcres: derive(mappedAcres, 'Sum of map-unit acres within the land unit boundary.', sources),
    primeAcres: derive(
      primeAcres,
      'Sum of acres in map units classified prime farmland.',
      sources,
    ),
    conditionallyPrimeAcres: derive(
      conditionallyPrimeAcres,
      'Sum of acres classified prime only if drained or if protected from flooding.',
      sources,
      {
        assumptions: [
          'Conditionally prime acres count toward prime farmland only where the stated condition is actually met on the ground.',
        ],
      },
    ),
    primePercent: derive(
      percent(primeAcres, mappedAcres),
      'Prime farmland acres as a percentage of mapped acres.',
      sources,
    ),
    primeIncludingConditionalPercent: derive(
      percent(primeAcres + conditionallyPrimeAcres, mappedAcres),
      'Prime plus conditionally-prime acres as a percentage of mapped acres.',
      sources,
      {
        basis: 'assumed',
        assumptions: [
          'Assumes every conditionally-prime map unit meets its condition; verify drainage and flood protection before using this figure in an application.',
        ],
      },
    ),
    hydricAcres: derive(hydricAcres, 'Sum of acres in map units flagged hydric.', sources),
    productivityIndex:
      coverage >= MIN_PRODUCTIVITY_COVERAGE && ratedAcres > 0
        ? derive(
            sum(rated.map((o) => (o.nccpi as number) * o.acres)) / ratedAcres,
            'Acreage-weighted mean NCCPI across rated map units.',
            sources,
          )
        : indeterminate(
            'Acreage-weighted mean NCCPI across rated map units.',
            `Only ${(coverage * 100).toFixed(0)}% of mapped acres carry an NCCPI rating; below the ${(
              MIN_PRODUCTIVITY_COVERAGE * 100
            ).toFixed(0)}% coverage floor required to report a parcel-level index.`,
            sources,
          ),
    productivityCoverage: derive(
      coverage,
      'Share of mapped acres in map units carrying an NCCPI rating.',
      sources,
    ),
    maxSlopePercent:
      observations.length > 0
        ? derive(
            Math.max(...observations.map((o) => o.slopePercent)),
            'Highest representative map-unit slope present in the land unit.',
            sources,
          )
        : indeterminate(
            'Highest representative map-unit slope present in the land unit.',
            'No soil map units supplied for this land unit.',
            sources,
          ),
    drainageComposition: derive(
      composeDrainage(observations),
      'Acres grouped by NRCS natural drainage class.',
      sources,
    ),
  };
}

function composeDrainage(observations: readonly SoilMapUnitObservation[]): DrainageAcres[] {
  const acresByClass = new Map<DrainageClass, number>();
  for (const observation of observations) {
    acresByClass.set(
      observation.drainageClass,
      (acresByClass.get(observation.drainageClass) ?? 0) + observation.acres,
    );
  }
  return DRAINAGE_CLASSES.filter((c) => acresByClass.has(c)).map((drainageClass) => ({
    drainageClass,
    acres: acresByClass.get(drainageClass) as number,
  }));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
