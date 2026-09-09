/**
 * Scenario construction and comparison (spec §5.4).
 *
 * Every scenario renders the same structure — what the land can still do, what
 * is irreversible, what it costs, what the timeline is, and who to call next —
 * because comparability is the product. Scenarios that do not line up are five
 * narratives, which is what the landowner already has.
 *
 * v1 implements the two scenarios that need no external rule data: status quo
 * and subdivision. PA 116, ACEP-ALE, and county PDR are Phase 3 and arrive as
 * versioned rule records (spec §5.5), not as code added here.
 *
 * Nothing in this module is advice. Costs and timelines are qualitative and
 * referrals are phrased as questions for a named professional, per spec §6.
 */

import type { EnterpriseId, ThresholdCatalog } from './enterprise.ts';
import type { Holding, LandUnit } from './land-unit.ts';
import { subdivide, type SplitPlan, type SubdivisionResult } from './subdivision.ts';
import { evaluateUnit, type UnitViability, type ViabilityStatus } from './viability.ts';

export type ScenarioKind = 'status-quo' | 'subdivision';

/** A person to call and the question to put to them. Never an instruction. */
export interface Referral {
  readonly who: string;
  readonly question: string;
}

export interface Scenario {
  readonly id: string;
  readonly kind: ScenarioKind;
  readonly label: string;
  readonly units: readonly LandUnit[];
  readonly assumptions: readonly string[];
  /** What this scenario forecloses, and how hard it is to undo. */
  readonly irreversibility: readonly string[];
  /** Qualitative cost drivers. No dollar figures: valuation is out of scope (§4). */
  readonly costs: readonly string[];
  readonly timeline: readonly string[];
  readonly referrals: readonly Referral[];
}

export interface EnterpriseOutlook {
  readonly enterprise: EnterpriseId;
  readonly label: string;
  /** Best status achieved on any single unit in the scenario. */
  readonly status: ViabilityStatus;
  /** Units on which the enterprise is supported outright. */
  readonly supportedOn: readonly string[];
  /** True where the best status rests on an estimated upper bound. */
  readonly provisional: boolean;
}

export interface ScenarioEvaluation {
  readonly scenario: Scenario;
  readonly units: readonly UnitViability[];
  /** Holding-level view: what the land can still do, somewhere. */
  readonly outlook: readonly EnterpriseOutlook[];
}

export function statusQuoScenario(holding: Holding): Scenario {
  return {
    id: 'status-quo',
    kind: 'status-quo',
    label: 'Status quo — no change',
    units: holding.units,
    assumptions: ['The holding stays as it is, in its current ownership and configuration.'],
    irreversibility: ['Nothing is foreclosed, and nothing is protected.'],
    costs: ['Property taxes at the current classification.'],
    timeline: ['No action, no deadline.'],
    referrals: [
      {
        who: 'Estate-planning attorney',
        question:
          'If nothing changes, what happens to this land under the current will, trust, or intestacy?',
      },
    ],
  };
}

export interface SubdivisionScenarioInput {
  readonly holding: Holding;
  /** Which unit is divided; other units pass through unchanged. */
  readonly unitId: string;
  readonly plan: SplitPlan;
  readonly id?: string;
  readonly label?: string;
}

export function subdivisionScenario(input: SubdivisionScenarioInput): Scenario {
  const target = input.holding.units.find((unit) => unit.id === input.unitId);
  if (target === undefined) {
    throw new Error(
      `Land unit "${input.unitId}" is not part of holding "${input.holding.id}".`,
    );
  }

  const result: SubdivisionResult = subdivide(target, input.plan);
  const shareCount = result.children.length;

  return {
    id: input.id ?? `subdivision-${shareCount}`,
    kind: 'subdivision',
    label: input.label ?? `Subdivision — ${target.label} into ${shareCount} shares`,
    units: input.holding.units.flatMap((unit) =>
      unit.id === target.id ? result.children : [unit],
    ),
    assumptions: result.assumptions,
    irreversibility: [
      'Division is effectively permanent. Recombining parcels needs every future owner to agree at the same time, and heirs rarely do.',
      'Michigan land division rights are finite and are consumed by each division. Divisions used now are not available to the next generation.',
      'Fragmented parcels are harder to protect later: easement and PDR programmes rank whole, contiguous, prime-soil blocks above fragments.',
    ],
    costs: [
      'Survey, deed preparation, and recording for each new parcel.',
      'New fence line, drive, and field access where an internal boundary now runs.',
      'Loss of scale in every operation that crosses the new line.',
    ],
    timeline: [
      'County or township land-division approval, typically weeks to months.',
      'Once recorded, the division is done; the decision has no trial period.',
    ],
    referrals: [
      {
        who: 'Land-use attorney',
        question:
          'How many divisions does this parcel still hold under the Land Division Act, and what does each one cost us later?',
      },
      {
        who: 'County or township land-division administrator',
        question: 'Would these shares be approved as drawn, and what frontage and access do they need?',
      },
      {
        who: 'Conservation District or MIFarmLink field staff',
        question:
          'If a share falls below viable size, who nearby would farm it, and on what terms?',
      },
    ],
  };
}

export function evaluateScenario(
  scenario: Scenario,
  catalog: ThresholdCatalog,
  enterprises: readonly EnterpriseId[] = catalog.requirements.map((r) => r.id),
): ScenarioEvaluation {
  const units = scenario.units.map((unit) => evaluateUnit(unit, catalog, enterprises));
  return { scenario, units, outlook: summarizeOutlook(units, enterprises) };
}

/** Ordered best-to-worst; used to pick a holding-level status from unit results. */
const STATUS_ORDER: readonly ViabilityStatus[] = [
  'supported',
  'supported-with-investment',
  'indeterminate',
  'not-supported',
];

export function statusRank(status: ViabilityStatus): number {
  return STATUS_ORDER.indexOf(status);
}

function summarizeOutlook(
  units: readonly UnitViability[],
  enterprises: readonly EnterpriseId[],
): EnterpriseOutlook[] {
  return enterprises.map((enterprise) => {
    const results = units.flatMap((unit) =>
      unit.enterprises
        .filter((candidate) => candidate.enterprise === enterprise)
        .map((candidate) => ({ unit, candidate })),
    );

    const best = results.reduce<(typeof results)[number] | undefined>(
      (winner, current) =>
        winner === undefined ||
        statusRank(current.candidate.status) < statusRank(winner.candidate.status)
          ? current
          : winner,
      undefined,
    );

    if (best === undefined) {
      return {
        enterprise,
        label: enterprise,
        status: 'indeterminate' as const,
        supportedOn: [],
        provisional: false,
      };
    }

    return {
      enterprise,
      label: best.candidate.label,
      status: best.candidate.status,
      supportedOn: results
        .filter(({ candidate }) => candidate.status === 'supported')
        .map(({ unit }) => unit.unitId),
      provisional: best.candidate.reliesOnEstimate,
    };
  });
}

export type ComparisonVerdict =
  | 'retained'
  | 'weakened'
  | 'lost'
  | 'gained'
  | 'uncertain'
  | 'unavailable-either-way';

export interface ComparisonCell {
  readonly scenarioId: string;
  readonly status: ViabilityStatus;
  readonly verdict: ComparisonVerdict;
  readonly provisional: boolean;
}

export interface ComparisonRow {
  readonly enterprise: EnterpriseId;
  readonly label: string;
  readonly baselineStatus: ViabilityStatus;
  readonly cells: readonly ComparisonCell[];
}

export interface ScenarioComparison {
  readonly baselineId: string;
  readonly rows: readonly ComparisonRow[];
  /** Per scenario, the enterprises the baseline supports and the scenario does not. */
  readonly lostByScenario: ReadonlyMap<string, readonly EnterpriseId[]>;
}

export function compareScenarios(
  baseline: ScenarioEvaluation,
  scenarios: readonly ScenarioEvaluation[],
): ScenarioComparison {
  const rows = baseline.outlook.map((baselineOutlook): ComparisonRow => ({
    enterprise: baselineOutlook.enterprise,
    label: baselineOutlook.label,
    baselineStatus: baselineOutlook.status,
    cells: scenarios.map((evaluation): ComparisonCell => {
      const outlook = evaluation.outlook.find(
        (candidate) => candidate.enterprise === baselineOutlook.enterprise,
      );
      const status: ViabilityStatus = outlook?.status ?? 'indeterminate';
      return {
        scenarioId: evaluation.scenario.id,
        status,
        verdict: verdictFor(baselineOutlook.status, status),
        provisional: outlook?.provisional ?? false,
      };
    }),
  }));

  const lostByScenario = new Map<string, EnterpriseId[]>();
  for (const evaluation of scenarios) {
    lostByScenario.set(
      evaluation.scenario.id,
      rows
        .filter((row) =>
          row.cells.some(
            (cell) => cell.scenarioId === evaluation.scenario.id && cell.verdict === 'lost',
          ),
        )
        .map((row) => row.enterprise),
    );
  }

  return { baselineId: baseline.scenario.id, rows, lostByScenario };
}

function verdictFor(baseline: ViabilityStatus, scenario: ViabilityStatus): ComparisonVerdict {
  if (baseline === scenario) {
    return baseline === 'not-supported'
      ? 'unavailable-either-way'
      : baseline === 'indeterminate'
        ? 'uncertain'
        : 'retained';
  }
  if (scenario === 'indeterminate') return 'uncertain';
  if (baseline === 'indeterminate') return 'uncertain';
  if (statusRank(scenario) < statusRank(baseline)) return 'gained';
  return scenario === 'not-supported' ? 'lost' : 'weakened';
}
