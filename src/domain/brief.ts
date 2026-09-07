/**
 * The brief: a documented, versioned JSON structure (spec §5.6).
 *
 * The PDF is the deliverable, but the JSON is what makes the analysis outlive
 * the product — a succession decision is a twenty-year artifact and this tool
 * will not be. Anything a renderer needs must be in here, including sources,
 * vintages, assumptions, and the disclaimers, so a brief can be re-rendered or
 * audited without re-running the model.
 *
 * The structure is plain data: no Maps, no dates, no class instances, so
 * `JSON.stringify(buildBrief(...))` round-trips.
 */

import { hasUnverifiedThresholds, type ThresholdCatalog } from './enterprise.ts';
import type { FragmentationReport } from './fragmentation.ts';
import type { Holding } from './land-unit.ts';
import { mergeSources, type SourceRef } from './provenance.ts';
import type { ScenarioComparison, ScenarioEvaluation } from './scenario.ts';

export const BRIEF_SCHEMA_VERSION = 'parcel-scenario-brief/1';

/**
 * Fixed copy. Spec §6: every output is indicative and phrased as a question for
 * a named professional. This text is a compliance surface — change it with the
 * same care as the model, and never let a renderer drop it.
 */
export const DISCLAIMERS: readonly string[] = [
  'This brief is indicative. It is not legal, tax, financial, or appraisal advice, and it is not a substitute for a site visit.',
  'Enterprise viability thresholds are modelling assumptions. Where a threshold is marked unverified, treat the result as a prompt for a conversation, not a finding.',
  'Soil figures come from SSURGO, a county-scale survey. It is not a substitute for on-site investigation, and its map-unit boundaries are approximate.',
  'Programme eligibility, land-division rights, and tax consequences are not modelled in this version. Ask the professionals named under each scenario.',
];

export interface CatalogSummary {
  readonly version: string;
  readonly effectiveFrom: string;
  readonly publisher: string;
  readonly unverifiedThresholds: boolean;
  readonly overrides: readonly {
    readonly enterprise: string;
    readonly field: string;
    readonly by: string;
    readonly reason: string;
    readonly at: string;
  }[];
}

export interface BriefExport {
  readonly schema: typeof BRIEF_SCHEMA_VERSION;
  /** ISO timestamp supplied by the caller, so the export is reproducible. */
  readonly generatedAt: string;
  readonly holding: {
    readonly id: string;
    readonly label: string;
    readonly acres: number;
    readonly units: readonly {
      readonly id: string;
      readonly label: string;
      readonly acres: number;
    }[];
  };
  readonly catalog: CatalogSummary;
  readonly baseline: ScenarioEvaluation;
  readonly scenarios: readonly ScenarioEvaluation[];
  readonly comparison: {
    readonly baselineId: string;
    readonly rows: ScenarioComparison['rows'];
    readonly lostByScenario: readonly {
      readonly scenarioId: string;
      readonly enterprises: readonly string[];
    }[];
  };
  readonly fragmentation: readonly FragmentationReport[];
  readonly sources: readonly SourceRef[];
  readonly disclaimers: readonly string[];
}

export interface BuildBriefInput {
  readonly holding: Holding;
  readonly catalog: ThresholdCatalog;
  readonly baseline: ScenarioEvaluation;
  readonly scenarios: readonly ScenarioEvaluation[];
  readonly comparison: ScenarioComparison;
  readonly fragmentation?: readonly FragmentationReport[];
  readonly generatedAt: string;
}

export function buildBrief(input: BuildBriefInput): BriefExport {
  const units = input.holding.units;
  return {
    schema: BRIEF_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    holding: {
      id: input.holding.id,
      label: input.holding.label,
      acres: units.reduce((total, unit) => total + unit.acres, 0),
      units: units.map((unit) => ({ id: unit.id, label: unit.label, acres: unit.acres })),
    },
    catalog: summarizeCatalog(input.catalog),
    baseline: input.baseline,
    scenarios: input.scenarios,
    comparison: {
      baselineId: input.comparison.baselineId,
      rows: input.comparison.rows,
      lostByScenario: [...input.comparison.lostByScenario].map(([scenarioId, enterprises]) => ({
        scenarioId,
        enterprises,
      })),
    },
    fragmentation: input.fragmentation ?? [],
    sources: mergeSources(units.map((unit) => unit.soilSource)),
    disclaimers: DISCLAIMERS,
  };
}

function summarizeCatalog(catalog: ThresholdCatalog): CatalogSummary {
  return {
    version: catalog.version,
    effectiveFrom: catalog.effectiveFrom,
    publisher: catalog.publisher,
    unverifiedThresholds: hasUnverifiedThresholds(catalog),
    overrides: catalog.overrides.map(({ override }) => ({
      enterprise: override.enterprise,
      field: override.field,
      by: override.by,
      reason: override.reason,
      at: override.at,
    })),
  };
}
