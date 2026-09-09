/**
 * The fragmentation threshold (spec §1).
 *
 * "At what point does subdivision drop each parcel below the minimum viable
 * acreage for the enterprises the land can actually support?" — the most
 * consequential number nobody computes, and the reason this product exists.
 *
 * The ladder walks equal-acreage splits from 1 to N and records where each
 * enterprise stops being supported, together with the criterion that stopped it.
 * A rung that reads `indeterminate` is as useful as one that reads
 * `not-supported`: it names the fact the advisor has to go and establish —
 * usually which share keeps the water.
 */

import type { EnterpriseId, ThresholdCatalog } from './enterprise.ts';
import type { LandUnit } from './land-unit.ts';
import { subdivide } from './subdivision.ts';
import {
  evaluateUnit,
  type CriterionResult,
  type EnterpriseViability,
  type ViabilityStatus,
} from './viability.ts';

export interface LadderRung {
  readonly shares: number;
  readonly status: ViabilityStatus;
  /** Criteria that are not met at this rung, in evaluation order. */
  readonly blocking: readonly BlockingCriterion[];
}

export interface BlockingCriterion {
  readonly criterion: string;
  readonly status: Exclude<CriterionResult['status'], 'met'>;
  readonly observed: string;
}

export interface FragmentationThreshold {
  readonly enterprise: EnterpriseId;
  readonly label: string;
  readonly baselineStatus: ViabilityStatus;
  /**
   * Largest number of equal shares at which the enterprise is still supported
   * outright. `null` when it is not supported even undivided.
   */
  readonly maxSharesSupported: number | null;
  /** As above, counting shortfalls that capital could cure. */
  readonly maxSharesSupportedWithInvestment: number | null;
  /** Smallest share count at which support is lost, within the range tested. */
  readonly firstFailingShares: number | null;
  readonly blockingAtFailure: readonly BlockingCriterion[];
  readonly ladder: readonly LadderRung[];
}

export interface FragmentationReport {
  readonly unitId: string;
  readonly unitLabel: string;
  readonly maxSharesTested: number;
  readonly thresholds: readonly FragmentationThreshold[];
  readonly caveats: readonly string[];
}

export interface FragmentationOptions {
  /** Highest number of shares to test. Defaults to 8. */
  readonly maxShares?: number;
  readonly enterprises?: readonly EnterpriseId[];
}

export function findFragmentationThresholds(
  unit: LandUnit,
  catalog: ThresholdCatalog,
  options: FragmentationOptions = {},
): FragmentationReport {
  const maxShares = options.maxShares ?? 8;
  if (!Number.isInteger(maxShares) || maxShares < 1) {
    throw new Error(`maxShares must be a whole number of at least 1; got ${maxShares}.`);
  }
  const enterprises = options.enterprises ?? catalog.requirements.map((r) => r.id);

  // Rung 1 is the undivided parcel; rung N is one share of an N-way split.
  // Shares are identical under an equal-acreage split, so one child stands for all.
  const rungs = new Map<number, readonly EnterpriseViability[]>();
  rungs.set(1, evaluateUnit(unit, catalog, enterprises).enterprises);
  for (let shares = 2; shares <= maxShares; shares += 1) {
    const [child] = subdivide(unit, { method: 'equal-acreage', shares }).children;
    if (child === undefined) continue;
    rungs.set(shares, evaluateUnit(child, catalog, enterprises).enterprises);
  }

  const thresholds = enterprises.map((enterprise) =>
    thresholdFor(enterprise, rungs, maxShares),
  );

  return {
    unitId: unit.id,
    unitLabel: unit.label,
    maxSharesTested: maxShares,
    thresholds,
    caveats: [
      'Every rung assumes an equal-acreage split with soils divided pro rata. A real split concentrates soils and water on some shares and strips them from others.',
      'Contiguous-acreage figures at each rung are upper bounds, so a rung that fails would also fail under any equal-acreage split; a rung that passes needs the geometry checked.',
      'Rungs below the undivided parcel do not account for the Land Division Act, which may allow fewer divisions than the model tests.',
    ],
  };
}

function thresholdFor(
  enterprise: EnterpriseId,
  rungs: ReadonlyMap<number, readonly EnterpriseViability[]>,
  maxShares: number,
): FragmentationThreshold {
  const ladder: LadderRung[] = [];
  let label = enterprise;

  for (let shares = 1; shares <= maxShares; shares += 1) {
    const result = rungs.get(shares)?.find((candidate) => candidate.enterprise === enterprise);
    if (result === undefined) continue;
    label = result.label;
    ladder.push({ shares, status: result.status, blocking: blockingCriteria(result) });
  }

  const supported = ladder.filter((rung) => rung.status === 'supported');
  const withInvestment = ladder.filter(
    (rung) => rung.status === 'supported' || rung.status === 'supported-with-investment',
  );
  const maxSharesSupported = supported.at(-1)?.shares ?? null;
  const firstFailing =
    ladder.find(
      (rung) =>
        maxSharesSupported !== null && rung.shares > maxSharesSupported,
    ) ?? (maxSharesSupported === null ? ladder[0] : undefined);

  return {
    enterprise,
    label,
    baselineStatus: ladder[0]?.status ?? 'indeterminate',
    maxSharesSupported,
    maxSharesSupportedWithInvestment: withInvestment.at(-1)?.shares ?? null,
    firstFailingShares: firstFailing?.shares ?? null,
    blockingAtFailure: firstFailing?.blocking ?? [],
    ladder,
  };
}

function blockingCriteria(result: EnterpriseViability): BlockingCriterion[] {
  return result.criteria
    .filter((criterion) => criterion.status !== 'met')
    .map((criterion) => ({
      criterion: criterion.criterion,
      status: criterion.status as BlockingCriterion['status'],
      observed: criterion.observed,
    }));
}
