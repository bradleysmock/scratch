/**
 * Subdivision modelling (spec §5.4, scenario 2).
 *
 * Two split methods, and the difference between them is epistemic rather than
 * cosmetic:
 *
 * - `explicit` — the advisor states what each share gets. This covers "along
 *   existing field boundaries" and "equal value" alike. Note that the spec lists
 *   equal-value splitting under §5.4 while §4 puts valuation permanently out of
 *   scope; the two are reconciled here by never computing value. An equal-value
 *   split is expressed as an explicit allocation whose valuation was done by an
 *   appraiser off-platform.
 *
 * - `equal-acreage` — the model divides the parent pro rata. Without geometry it
 *   cannot know which share keeps the creek, the flat ground, or the road
 *   frontage, so every figure it derives is stated as an *upper bound*: a share
 *   of a parcel can never hold more contiguous tillable ground than its
 *   proportional share of the parent's largest block, and usually holds less.
 *
 * The upper-bound convention is what makes the headline output trustworthy. An
 * enterprise the model reports as lost under an equal-acreage split is lost
 * under any equal-acreage split; an enterprise it reports as retained is
 * retained only if the geometry cooperates. Losses are sound, retentions are
 * provisional, and the brief says so.
 */

import {
  landUnit,
  type AcreMeasure,
  type FencingState,
  type LandUnit,
  type WaterAccess,
} from './land-unit.ts';
import type { SoilMapUnitObservation } from './soil.ts';

export interface EqualAcreagePlan {
  readonly method: 'equal-acreage';
  readonly shares: number;
}

/** Why the shares are drawn as they are; recorded, never computed. */
export type ExplicitRationale = 'field-boundaries' | 'equal-value' | 'other';

export interface ExplicitShare {
  readonly label: string;
  readonly acres: number;
  readonly soils: readonly SoilMapUnitObservation[];
  readonly contiguousAcres: AcreMeasure;
  readonly contiguousTillableAcres?: AcreMeasure | null;
  readonly waterAccess?: WaterAccess;
  readonly fencing?: FencingState;
}

export interface ExplicitPlan {
  readonly method: 'explicit';
  readonly rationale: ExplicitRationale;
  readonly shares: readonly ExplicitShare[];
}

export type SplitPlan = EqualAcreagePlan | ExplicitPlan;

export interface SubdivisionResult {
  readonly parent: LandUnit;
  readonly children: readonly LandUnit[];
  readonly method: SplitPlan['method'];
  /** Modelling caveats a reader must see before trusting the child figures. */
  readonly assumptions: readonly string[];
}

export class SubdivisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubdivisionError';
  }
}

/** Acreage tolerance when checking that an explicit allocation adds up. */
const ACRE_TOLERANCE = 0.05;

export function subdivide(unit: LandUnit, plan: SplitPlan): SubdivisionResult {
  return plan.method === 'equal-acreage'
    ? splitEqualAcreage(unit, plan)
    : splitExplicitly(unit, plan);
}

function splitEqualAcreage(unit: LandUnit, plan: EqualAcreagePlan): SubdivisionResult {
  if (!Number.isInteger(plan.shares) || plan.shares < 2) {
    throw new SubdivisionError(
      `An equal-acreage split needs at least 2 whole shares; got ${plan.shares}.`,
    );
  }

  const shareOf = (acres: number): number => acres / plan.shares;
  const upperBound = (measure: AcreMeasure, what: string): AcreMeasure => ({
    acres: shareOf(measure.acres),
    basis: 'estimated-upper-bound',
    note: `Upper bound: the parent's ${what} divided by ${plan.shares}. Actual ${what} depends on where the lines are drawn and cannot exceed this figure.`,
  });

  const children = Array.from({ length: plan.shares }, (_, index) =>
    landUnit({
      id: `${unit.id}-share-${index + 1}`,
      label: `${unit.label} — share ${index + 1} of ${plan.shares}`,
      acres: shareOf(unit.acres),
      contiguousAcres: upperBound(unit.contiguousAcres, 'largest contiguous block'),
      contiguousTillableAcres:
        unit.contiguousTillableAcres === null
          ? null
          : upperBound(unit.contiguousTillableAcres, 'largest contiguous tillable block'),
      soils: unit.soils.map((observation) => ({
        ...observation,
        acres: shareOf(observation.acres),
      })),
      soilSource: unit.soilSource,
      waterAccess: dividedWaterAccess(unit.waterAccess),
      fencing: dividedFencing(unit.fencing),
      notes: [
        ...unit.notes,
        `Modelled as one of ${plan.shares} equal-acreage shares of ${unit.label}. No geometry was used.`,
      ],
    }),
  );

  return {
    parent: unit,
    children,
    method: 'equal-acreage',
    assumptions: [
      `Each share receives ${(100 / plan.shares).toFixed(1)}% of every soil map unit. A real split concentrates soils instead: one share gets the muck, another the loam.`,
      'Contiguous-acreage figures are upper bounds. An enterprise shown as lost here is lost under any equal-acreage split of this parcel; an enterprise shown as retained needs the geometry checked before it can be relied on.',
      'Water access is treated as unknown for each share unless the parent had none, because the model cannot tell which share keeps the water.',
      'Existing perimeter fencing becomes partial fencing on each share: an internal division line is a new fence line.',
      'Michigan Land Division Act limits on the number and size of divisions are not modelled. Ask the county and a land-use attorney whether this many divisions are available on this parcel.',
    ],
  };
}

/** After a split, only "no water anywhere" survives as a certainty. */
function dividedWaterAccess(parent: WaterAccess): WaterAccess {
  return parent === 'none' ? 'none' : 'unknown';
}

/** A perimeter fence around the whole becomes a partial fence around each share. */
function dividedFencing(parent: FencingState): FencingState {
  if (parent === 'none' || parent === 'unknown') return parent;
  return 'partial';
}

function splitExplicitly(unit: LandUnit, plan: ExplicitPlan): SubdivisionResult {
  if (plan.shares.length < 2) {
    throw new SubdivisionError(
      `An explicit split needs at least 2 shares; got ${plan.shares.length}.`,
    );
  }

  const allocatedAcres = plan.shares.reduce((total, share) => total + share.acres, 0);
  if (allocatedAcres > unit.acres + ACRE_TOLERANCE) {
    throw new SubdivisionError(
      `Explicit shares allocate ${allocatedAcres.toFixed(2)} acres, more than the ${unit.acres.toFixed(
        2,
      )} acres in ${unit.label}.`,
    );
  }

  for (const share of plan.shares) {
    const soilAcres = share.soils.reduce((total, observation) => total + observation.acres, 0);
    if (soilAcres > share.acres + ACRE_TOLERANCE) {
      throw new SubdivisionError(
        `Share "${share.label}" maps ${soilAcres.toFixed(2)} soil acres onto ${share.acres.toFixed(
          2,
        )} allocated acres.`,
      );
    }
    if (share.contiguousAcres.acres > share.acres + ACRE_TOLERANCE) {
      throw new SubdivisionError(
        `Share "${share.label}" claims a ${share.contiguousAcres.acres.toFixed(
          2,
        )}-acre contiguous block within ${share.acres.toFixed(2)} allocated acres.`,
      );
    }
  }

  const children = plan.shares.map((share, index) =>
    landUnit({
      id: `${unit.id}-share-${index + 1}`,
      label: share.label,
      acres: share.acres,
      contiguousAcres: share.contiguousAcres,
      contiguousTillableAcres: share.contiguousTillableAcres ?? null,
      soils: share.soils,
      soilSource: unit.soilSource,
      waterAccess: share.waterAccess ?? 'unknown',
      fencing: share.fencing ?? dividedFencing(unit.fencing),
      notes: [...unit.notes, `Explicit share of ${unit.label} (${plan.rationale}).`],
    }),
  );

  const unallocated = unit.acres - allocatedAcres;
  const assumptions = [
    'Share boundaries, soils, and contiguous acreages are as supplied by the advisor; the model did not derive them.',
    'Michigan Land Division Act limits on the number and size of divisions are not modelled. Ask the county and a land-use attorney whether this many divisions are available on this parcel.',
  ];

  if (plan.rationale === 'equal-value') {
    assumptions.push(
      'Equal-value shares rest on a valuation this tool does not perform and cannot check. The valuation is the appraiser’s, and it dates.',
    );
  }
  if (unallocated > ACRE_TOLERANCE) {
    assumptions.push(
      `${unallocated.toFixed(1)} acres of ${unit.label} are not allocated to any share and are excluded from the scenario.`,
    );
  }

  return { parent: unit, children, method: 'explicit', assumptions };
}
