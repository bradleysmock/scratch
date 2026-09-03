/**
 * Enterprise viability requirements (spec §5.3).
 *
 * Thresholds are data, never code: `EnterpriseId` is an open string so a new
 * enterprise is a data edit, and every requirement carries a citation whose
 * status the brief reports. An advisor who disagrees with a threshold overrides
 * it (see `applyOverride`) rather than losing trust in the tool.
 */

import type { DrainageClass } from './soil.ts';

export type EnterpriseId = string;

/** The seven enterprises named in the spec; the catalog may carry others. */
export const SPEC_ENTERPRISE_IDS = [
  'row-crop',
  'hay',
  'managed-grazing',
  'orchard',
  'vegetable',
  'timber',
  'agroforestry',
] as const;

/**
 * Whether a whole-tract or tillable-only figure governs the acreage test.
 * Timber and grazing are not tillage-limited; row crop and vegetable are.
 */
export type LandBase = 'tillable' | 'total';

export type WaterRequirement = 'not-required' | 'seasonal' | 'year-round';
export type FencingRequirement = 'not-required' | 'perimeter';

/** Inclusive window over the ordered drainage classes. */
export interface DrainageWindow {
  readonly wettest: DrainageClass;
  readonly driest: DrainageClass;
}

export type CitationStatus = 'verified' | 'unverified-placeholder';

export interface Citation {
  /**
   * `unverified-placeholder` means the figure is a working assumption that has
   * not been traced to a published source. Spec open question 4: an indefensible
   * threshold discredits the whole tool, so unverified thresholds are disclosed
   * in every output rather than silently trusted.
   */
  readonly status: CitationStatus;
  readonly source: string;
  readonly reference?: string;
  readonly retrieved?: string;
  readonly note?: string;
}

/** What a piece of ground must offer for an enterprise to be practicable on it. */
export interface EnterpriseRequirement {
  readonly id: EnterpriseId;
  readonly label: string;
  readonly landBase: LandBase;
  readonly minimumContiguousAcres: number;
  readonly drainageTolerance: DrainageWindow;
  readonly maxSlopePercent: number;
  readonly waterAccess: WaterRequirement;
  readonly fencing: FencingRequirement;
  /** NCCPI floor, 0–1, or `null` where productivity does not gate the enterprise. */
  readonly minimumProductivityIndex: number | null;
  readonly remediation: RemediationOptions;
  readonly citation: Citation;
}

/**
 * Which shortfalls capital can cure. This is the difference between "the land
 * cannot do this" and "the land cannot do this as it stands" — a distinction the
 * landowner is entitled to see, and one the spec's binary supported-set framing
 * would otherwise flatten.
 */
export interface RemediationOptions {
  /** Whether tile drainage is a recognised remedy for excess wetness here. */
  readonly drainageByTile: boolean;
  /** Whether the fencing requirement can be met by installing fence. */
  readonly fencingInstallable: boolean;
}

export interface ThresholdCatalog {
  readonly version: string;
  /** ISO date the threshold set takes effect; supports versioned rule data (§5.5). */
  readonly effectiveFrom: string;
  readonly publisher: string;
  readonly notes: readonly string[];
  readonly requirements: readonly EnterpriseRequirement[];
  /** Advisor overrides applied to this catalog, in application order. */
  readonly overrides: readonly AppliedOverride[];
}

export type ThresholdOverride =
  | NumericOverride
  | ProductivityOverride
  | DrainageOverride;

interface OverrideBase {
  readonly enterprise: EnterpriseId;
  /** Who made the call — the audit trail required by spec §6. */
  readonly by: string;
  readonly reason: string;
  /** ISO timestamp. */
  readonly at: string;
}

export interface NumericOverride extends OverrideBase {
  readonly field: 'minimumContiguousAcres' | 'maxSlopePercent';
  readonly value: number;
}

export interface ProductivityOverride extends OverrideBase {
  readonly field: 'minimumProductivityIndex';
  readonly value: number | null;
}

export interface DrainageOverride extends OverrideBase {
  readonly field: 'drainageTolerance';
  readonly value: DrainageWindow;
}

export interface AppliedOverride {
  readonly override: ThresholdOverride;
  /** The value the override displaced, for the audit trail. */
  readonly previousValue: number | null | DrainageWindow;
}

export function findRequirement(
  catalog: ThresholdCatalog,
  enterprise: EnterpriseId,
): EnterpriseRequirement | undefined {
  return catalog.requirements.find((requirement) => requirement.id === enterprise);
}

/** True when any requirement in the catalog rests on an unverified figure. */
export function hasUnverifiedThresholds(catalog: ThresholdCatalog): boolean {
  return catalog.requirements.some(
    (requirement) => requirement.citation.status === 'unverified-placeholder',
  );
}

/**
 * Returns a new catalog with the override applied and recorded. The catalog is
 * never mutated: a brief must be reproducible from the catalog version plus its
 * override list.
 */
export function applyOverride(
  catalog: ThresholdCatalog,
  override: ThresholdOverride,
): ThresholdCatalog {
  const target = findRequirement(catalog, override.enterprise);
  if (target === undefined) {
    throw new Error(
      `Cannot override unknown enterprise "${override.enterprise}" in threshold catalog ${catalog.version}.`,
    );
  }

  const previousValue = target[override.field];
  const replacement = overrideRequirement(target, override);

  return {
    ...catalog,
    requirements: catalog.requirements.map((requirement) =>
      requirement.id === override.enterprise ? replacement : requirement,
    ),
    overrides: [...catalog.overrides, { override, previousValue }],
  };
}

function overrideRequirement(
  requirement: EnterpriseRequirement,
  override: ThresholdOverride,
): EnterpriseRequirement {
  const citation: Citation = {
    status: 'unverified-placeholder',
    source: `Advisor override by ${override.by}`,
    note: override.reason,
    retrieved: override.at,
  };

  switch (override.field) {
    case 'minimumContiguousAcres':
      return { ...requirement, minimumContiguousAcres: override.value, citation };
    case 'maxSlopePercent':
      return { ...requirement, maxSlopePercent: override.value, citation };
    case 'minimumProductivityIndex':
      return { ...requirement, minimumProductivityIndex: override.value, citation };
    case 'drainageTolerance':
      return { ...requirement, drainageTolerance: override.value, citation };
  }
}
