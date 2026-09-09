/**
 * The enterprise viability model (spec §5.3) — the differentiating logic.
 *
 * Applied to a land unit, it yields the supported-enterprise set. Applied to a
 * subdivided land unit, it yields the set that survives the split; the delta
 * between the two is the headline output of the product.
 *
 * Three properties govern every judgement here:
 *
 * 1. Missing data yields `indeterminate`, never a default. A brief that quietly
 *    treats unknown water access as "none" is wrong in a way nobody can see.
 * 2. Shortfalls capital can cure are reported separately from shortfalls it
 *    cannot. "You would need to fence it" is a different answer from "the slope
 *    forbids it".
 * 3. A criterion evaluated against an estimated upper bound (see subdivision.ts)
 *    marks its result `reliesOnEstimate`. A negative verdict on an upper bound is
 *    sound — the true figure cannot be larger — while a positive one is
 *    provisional. Losses this model reports are therefore conservative.
 */

import {
  findRequirement,
  type EnterpriseId,
  type EnterpriseRequirement,
  type ThresholdCatalog,
} from './enterprise.ts';
import {
  drainageRank,
  summarizeSoils,
  type SoilMapUnitObservation,
  type SoilSummary,
} from './soil.ts';
import {
  waterAccessRank,
  type AcreMeasure,
  type LandUnit,
} from './land-unit.ts';
import { type Basis, type SourceRef } from './provenance.ts';

export type CriterionStatus = 'met' | 'unmet' | 'unmet-remediable' | 'indeterminate';

export type ViabilityStatus =
  | 'supported'
  | 'supported-with-investment'
  | 'not-supported'
  | 'indeterminate';

export interface CriterionResult {
  readonly criterion: string;
  readonly status: CriterionStatus;
  /** What the threshold catalog asks of the land, in plain language. */
  readonly requirement: string;
  /** What the parcel data says, in plain language. */
  readonly observed: string;
  readonly basis: Basis;
  readonly note?: string;
}

export interface EnterpriseViability {
  readonly enterprise: EnterpriseId;
  readonly label: string;
  readonly status: ViabilityStatus;
  readonly criteria: readonly CriterionResult[];
  /**
   * True when a met-or-remediable criterion rested on an estimated upper bound.
   * A `supported` verdict carrying this flag needs geometry to confirm.
   */
  readonly reliesOnEstimate: boolean;
  /** True when the governing threshold has not been traced to a source. */
  readonly thresholdUnverified: boolean;
  readonly thresholdVersion: string;
  readonly sources: readonly SourceRef[];
}

export interface UnitViability {
  readonly unitId: string;
  readonly unitLabel: string;
  readonly acres: number;
  readonly soils: SoilSummary;
  readonly enterprises: readonly EnterpriseViability[];
}

/** Enterprises with the given statuses, as a sorted id list. */
export function enterpriseSet(
  viability: UnitViability,
  statuses: readonly ViabilityStatus[] = ['supported'],
): EnterpriseId[] {
  return viability.enterprises
    .filter((enterprise) => statuses.includes(enterprise.status))
    .map((enterprise) => enterprise.enterprise)
    .sort();
}

export function evaluateUnit(
  unit: LandUnit,
  catalog: ThresholdCatalog,
  enterprises: readonly EnterpriseId[] = catalog.requirements.map((r) => r.id),
): UnitViability {
  const soils = summarizeSoils(unit.soils, unit.soilSource);
  return {
    unitId: unit.id,
    unitLabel: unit.label,
    acres: unit.acres,
    soils,
    enterprises: enterprises.map((enterprise) =>
      evaluateEnterprise(unit, soils, catalog, enterprise),
    ),
  };
}

export function evaluateEnterprise(
  unit: LandUnit,
  soils: SoilSummary,
  catalog: ThresholdCatalog,
  enterprise: EnterpriseId,
): EnterpriseViability {
  const requirement = findRequirement(catalog, enterprise);
  if (requirement === undefined) {
    throw new Error(
      `Enterprise "${enterprise}" is not defined in threshold catalog ${catalog.version}.`,
    );
  }

  const criteria: CriterionResult[] = [
    acreageCriterion(unit, requirement),
    drainageCriterion(unit.soils, requirement),
    slopeCriterion(unit.soils, requirement),
    waterCriterion(unit, requirement),
    fencingCriterion(unit, requirement),
  ];

  const productivity = productivityCriterion(soils, requirement);
  if (productivity !== null) criteria.push(productivity);

  return {
    enterprise: requirement.id,
    label: requirement.label,
    status: aggregate(criteria),
    criteria,
    reliesOnEstimate: criteria.some(
      (criterion) =>
        criterion.basis === 'estimated-upper-bound' &&
        (criterion.status === 'met' || criterion.status === 'unmet-remediable'),
    ),
    thresholdUnverified: requirement.citation.status === 'unverified-placeholder',
    thresholdVersion: catalog.version,
    sources: [unit.soilSource],
  };
}

/**
 * A hard shortfall is decisive even when other criteria are unknown: no amount
 * of missing information makes a 20% slope tillable.
 */
function aggregate(criteria: readonly CriterionResult[]): ViabilityStatus {
  if (criteria.some((criterion) => criterion.status === 'unmet')) return 'not-supported';
  if (criteria.some((criterion) => criterion.status === 'indeterminate')) return 'indeterminate';
  if (criteria.some((criterion) => criterion.status === 'unmet-remediable')) {
    return 'supported-with-investment';
  }
  return 'supported';
}

function acreageCriterion(unit: LandUnit, requirement: EnterpriseRequirement): CriterionResult {
  const measure: AcreMeasure | null =
    requirement.landBase === 'tillable' ? unit.contiguousTillableAcres : unit.contiguousAcres;
  const label = requirement.landBase === 'tillable' ? 'contiguous tillable' : 'contiguous';
  const text = `At least ${requirement.minimumContiguousAcres} ${label} acres.`;

  if (measure === null) {
    return {
      criterion: 'minimum contiguous acreage',
      status: 'indeterminate',
      requirement: text,
      observed: `Contiguous ${label} acreage is not recorded for this land unit.`,
      basis: 'unknown',
      note: 'Supply a tillable-land figure from the parcel layer, or measure it in the field.',
    };
  }

  const met = measure.acres >= requirement.minimumContiguousAcres;
  return {
    criterion: 'minimum contiguous acreage',
    status: met ? 'met' : 'unmet',
    requirement: text,
    observed: `${round(measure.acres)} ${label} acres.`,
    basis: measure.basis,
    ...(measure.note === undefined ? {} : { note: measure.note }),
  };
}

/**
 * Drainage is tested as an acreage question, not a dominance question: the
 * enterprise needs enough ground inside its drainage window to reach its own
 * minimum acreage. Tile drainage counts as a remedy only where the catalog says
 * it does, and never on hydric or very poorly drained ground — that is wetland,
 * where drainage is a regulatory matter (Swampbuster, Part 303) rather than an
 * engineering one.
 */
function drainageCriterion(
  observations: readonly SoilMapUnitObservation[],
  requirement: EnterpriseRequirement,
): CriterionResult {
  const text = `Soils between ${requirement.drainageTolerance.wettest} and ${requirement.drainageTolerance.driest} across at least ${requirement.minimumContiguousAcres} acres.`;

  if (observations.length === 0) {
    return {
      criterion: 'drainage class tolerance',
      status: 'indeterminate',
      requirement: text,
      observed: 'No soil map units are attached to this land unit.',
      basis: 'unknown',
      note: 'Attach SSURGO map units before relying on this result.',
    };
  }

  const wettestRank = drainageRank(requirement.drainageTolerance.wettest);
  const driestRank = drainageRank(requirement.drainageTolerance.driest);
  const withinAcres = acresWhere(observations, (o) => {
    const rank = drainageRank(o.drainageClass);
    return rank >= wettestRank && rank <= driestRank;
  });

  if (withinAcres >= requirement.minimumContiguousAcres) {
    return {
      criterion: 'drainage class tolerance',
      status: 'met',
      requirement: text,
      observed: `${round(withinAcres)} acres within tolerance.`,
      basis: 'observed',
    };
  }

  const tileableAcres = requirement.remediation.drainageByTile
    ? acresWhere(
        observations,
        (o) =>
          drainageRank(o.drainageClass) < wettestRank &&
          o.drainageClass !== 'very poorly drained' &&
          !o.hydric,
      )
    : 0;

  if (withinAcres + tileableAcres >= requirement.minimumContiguousAcres) {
    return {
      criterion: 'drainage class tolerance',
      status: 'unmet-remediable',
      requirement: text,
      observed: `${round(withinAcres)} acres within tolerance; a further ${round(
        tileableAcres,
      )} acres are wetter than tolerated but not hydric.`,
      basis: 'observed',
      note: 'Reaching the acreage would require tile drainage. Confirm outlet, cost, and wetland status with NRCS before assuming it is available.',
    };
  }

  return {
    criterion: 'drainage class tolerance',
    status: 'unmet',
    requirement: text,
    observed: `Only ${round(withinAcres)} acres fall within the drainage tolerance.`,
    basis: 'observed',
  };
}

function slopeCriterion(
  observations: readonly SoilMapUnitObservation[],
  requirement: EnterpriseRequirement,
): CriterionResult {
  const text = `At least ${requirement.minimumContiguousAcres} acres at or below ${requirement.maxSlopePercent}% slope.`;

  if (observations.length === 0) {
    return {
      criterion: 'slope ceiling',
      status: 'indeterminate',
      requirement: text,
      observed: 'No soil map units are attached to this land unit.',
      basis: 'unknown',
    };
  }

  const withinAcres = acresWhere(
    observations,
    (o) => o.slopePercent <= requirement.maxSlopePercent,
  );

  return {
    criterion: 'slope ceiling',
    status: withinAcres >= requirement.minimumContiguousAcres ? 'met' : 'unmet',
    requirement: text,
    observed: `${round(withinAcres)} acres at or below the slope ceiling.`,
    basis: 'observed',
  };
}

function waterCriterion(unit: LandUnit, requirement: EnterpriseRequirement): CriterionResult {
  const text =
    requirement.waterAccess === 'not-required'
      ? 'No water access requirement.'
      : `${requirement.waterAccess === 'year-round' ? 'Year-round' : 'Seasonal'} water access.`;

  if (requirement.waterAccess === 'not-required') {
    return {
      criterion: 'water access',
      status: 'met',
      requirement: text,
      observed: `Recorded water access: ${unit.waterAccess}.`,
      basis: 'observed',
    };
  }

  if (unit.waterAccess === 'unknown') {
    return {
      criterion: 'water access',
      status: 'indeterminate',
      requirement: text,
      observed: 'Water access is not recorded for this land unit.',
      basis: 'unknown',
      note: 'Record whether livestock or irrigation water is available, and whether it holds through August.',
    };
  }

  const met = waterAccessRank(unit.waterAccess) >= waterAccessRank(requirement.waterAccess);
  return {
    criterion: 'water access',
    status: met ? 'met' : 'unmet',
    requirement: text,
    observed: `Recorded water access: ${unit.waterAccess}.`,
    basis: 'observed',
    ...(met
      ? {}
      : {
          note: 'Developing water (well, pipeline, pond) may change this. Cost is outside the scope of this model — ask the Conservation District about EQIP water-development practices.',
        }),
  };
}

function fencingCriterion(unit: LandUnit, requirement: EnterpriseRequirement): CriterionResult {
  const text =
    requirement.fencing === 'not-required'
      ? 'No fencing requirement.'
      : 'Perimeter fencing.';

  if (requirement.fencing === 'not-required') {
    return {
      criterion: 'fencing',
      status: 'met',
      requirement: text,
      observed: `Recorded fencing: ${unit.fencing}.`,
      basis: 'observed',
    };
  }

  if (unit.fencing === 'perimeter') {
    return {
      criterion: 'fencing',
      status: 'met',
      requirement: text,
      observed: 'Perimeter fencing recorded.',
      basis: 'observed',
    };
  }

  if (!requirement.remediation.fencingInstallable) {
    return {
      criterion: 'fencing',
      status: 'unmet',
      requirement: text,
      observed: `Recorded fencing: ${unit.fencing}.`,
      basis: unit.fencing === 'unknown' ? 'unknown' : 'observed',
    };
  }

  return {
    criterion: 'fencing',
    status: 'unmet-remediable',
    requirement: text,
    observed:
      unit.fencing === 'unknown'
        ? 'Fencing is not recorded; treated as absent for costing purposes.'
        : `Recorded fencing: ${unit.fencing}.`,
    basis: unit.fencing === 'unknown' ? 'assumed' : 'observed',
    note: 'Fence can be built. Perimeter length scales with the number of shares in a subdivision — a four-way split fences four perimeters, not one.',
  };
}

function productivityCriterion(
  soils: SoilSummary,
  requirement: EnterpriseRequirement,
): CriterionResult | null {
  if (requirement.minimumProductivityIndex === null) return null;

  const floor = requirement.minimumProductivityIndex;
  const text = `Acreage-weighted NCCPI of at least ${floor.toFixed(2)}.`;
  const index = soils.productivityIndex;

  if (index.value === null) {
    return {
      criterion: 'productivity index floor',
      status: 'indeterminate',
      requirement: text,
      observed: 'Parcel-level NCCPI could not be computed.',
      basis: 'unknown',
      ...(index.assumptions[0] === undefined ? {} : { note: index.assumptions[0] }),
    };
  }

  return {
    criterion: 'productivity index floor',
    status: index.value >= floor ? 'met' : 'unmet',
    requirement: text,
    observed: `Acreage-weighted NCCPI ${index.value.toFixed(2)} over ${(
      soils.productivityCoverage.value * 100
    ).toFixed(0)}% of mapped acres.`,
    basis: index.basis,
  };
}

function acresWhere(
  observations: readonly SoilMapUnitObservation[],
  predicate: (observation: SoilMapUnitObservation) => boolean,
): number {
  return observations
    .filter(predicate)
    .reduce((total, observation) => total + observation.acres, 0);
}

function round(value: number): string {
  return value.toFixed(1);
}
