/**
 * Validation of threshold catalogs (spec §5.3, §5.5).
 *
 * Parsing lives in the domain, not at the file-reading boundary, so a catalog
 * loaded from a file, a database, or an advisor's edit form is subject to the
 * same checks and the same tests. The loader in `src/data` only supplies bytes.
 *
 * A malformed catalog throws. A brief built on a silently-defaulted threshold is
 * worse than no brief: the number would look authoritative and be invented.
 */

import {
  DRAINAGE_CLASSES,
  drainageRank,
  type DrainageClass,
} from './soil.ts';
import type {
  Citation,
  CitationStatus,
  DrainageWindow,
  EnterpriseRequirement,
  FencingRequirement,
  LandBase,
  RemediationOptions,
  ThresholdCatalog,
  WaterRequirement,
} from './enterprise.ts';

export class ThresholdCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThresholdCatalogError';
  }
}

export function parseThresholdCatalog(input: unknown): ThresholdCatalog {
  const root = asObject(input, 'catalog');
  const requirements = asArray(root['requirements'], 'catalog.requirements').map(
    (entry, index) => parseRequirement(entry, `catalog.requirements[${index}]`),
  );

  if (requirements.length === 0) {
    throw new ThresholdCatalogError('catalog.requirements: catalog defines no enterprises.');
  }

  const duplicates = findDuplicates(requirements.map((requirement) => requirement.id));
  if (duplicates.length > 0) {
    throw new ThresholdCatalogError(
      `catalog.requirements: duplicate enterprise ids ${duplicates.join(', ')}.`,
    );
  }

  return {
    version: asString(root['version'], 'catalog.version'),
    effectiveFrom: asIsoDate(root['effectiveFrom'], 'catalog.effectiveFrom'),
    publisher: asString(root['publisher'], 'catalog.publisher'),
    notes: asOptionalStringArray(root['notes'], 'catalog.notes'),
    requirements,
    overrides: [],
  };
}

function parseRequirement(input: unknown, path: string): EnterpriseRequirement {
  const raw = asObject(input, path);

  const minimumContiguousAcres = asNumber(
    raw['minimumContiguousAcres'],
    `${path}.minimumContiguousAcres`,
  );
  if (minimumContiguousAcres <= 0) {
    throw new ThresholdCatalogError(
      `${path}.minimumContiguousAcres: must be greater than zero, got ${minimumContiguousAcres}.`,
    );
  }

  const maxSlopePercent = asNumber(raw['maxSlopePercent'], `${path}.maxSlopePercent`);
  if (maxSlopePercent < 0) {
    throw new ThresholdCatalogError(
      `${path}.maxSlopePercent: must not be negative, got ${maxSlopePercent}.`,
    );
  }

  return {
    id: asString(raw['id'], `${path}.id`),
    label: asString(raw['label'], `${path}.label`),
    landBase: asMember<LandBase>(raw['landBase'], ['tillable', 'total'], `${path}.landBase`),
    minimumContiguousAcres,
    drainageTolerance: parseDrainageWindow(raw['drainageTolerance'], `${path}.drainageTolerance`),
    maxSlopePercent,
    waterAccess: asMember<WaterRequirement>(
      raw['waterAccess'],
      ['not-required', 'seasonal', 'year-round'],
      `${path}.waterAccess`,
    ),
    fencing: asMember<FencingRequirement>(
      raw['fencing'],
      ['not-required', 'perimeter'],
      `${path}.fencing`,
    ),
    minimumProductivityIndex: parseProductivityFloor(
      raw['minimumProductivityIndex'],
      `${path}.minimumProductivityIndex`,
    ),
    remediation: parseRemediation(raw['remediation'], `${path}.remediation`),
    citation: parseCitation(raw['citation'], `${path}.citation`),
  };
}

export function parseDrainageWindow(input: unknown, path: string): DrainageWindow {
  const raw = asObject(input, path);
  const wettest = asMember<DrainageClass>(raw['wettest'], DRAINAGE_CLASSES, `${path}.wettest`);
  const driest = asMember<DrainageClass>(raw['driest'], DRAINAGE_CLASSES, `${path}.driest`);
  if (drainageRank(wettest) > drainageRank(driest)) {
    throw new ThresholdCatalogError(
      `${path}: window is inverted — "${wettest}" is drier than "${driest}".`,
    );
  }
  return { wettest, driest };
}

function parseProductivityFloor(input: unknown, path: string): number | null {
  if (input === null || input === undefined) return null;
  const value = asNumber(input, path);
  if (value < 0 || value > 1) {
    throw new ThresholdCatalogError(`${path}: NCCPI floor must be between 0 and 1, got ${value}.`);
  }
  return value;
}

function parseRemediation(input: unknown, path: string): RemediationOptions {
  const raw = asObject(input, path);
  return {
    drainageByTile: asBoolean(raw['drainageByTile'], `${path}.drainageByTile`),
    fencingInstallable: asBoolean(raw['fencingInstallable'], `${path}.fencingInstallable`),
  };
}

function parseCitation(input: unknown, path: string): Citation {
  const raw = asObject(input, path);
  const citation: Citation = {
    status: asMember<CitationStatus>(
      raw['status'],
      ['verified', 'unverified-placeholder'],
      `${path}.status`,
    ),
    source: asString(raw['source'], `${path}.source`),
  };
  // Optional fields are omitted rather than set to undefined, so a serialized
  // catalog round-trips without sprouting null keys.
  return {
    ...citation,
    ...optionalString(raw['reference'], `${path}.reference`, 'reference'),
    ...optionalString(raw['retrieved'], `${path}.retrieved`, 'retrieved'),
    ...optionalString(raw['note'], `${path}.note`, 'note'),
  };
}

function optionalString(
  value: unknown,
  path: string,
  key: string,
): Record<string, string> {
  if (value === undefined || value === null) return {};
  return { [key]: asString(value, path) };
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ThresholdCatalogError(`${path}: expected an object, got ${describe(value)}.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ThresholdCatalogError(`${path}: expected an array, got ${describe(value)}.`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ThresholdCatalogError(`${path}: expected a non-empty string, got ${describe(value)}.`);
  }
  return value;
}

function asIsoDate(value: unknown, path: string): string {
  const text = asString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new ThresholdCatalogError(`${path}: expected an ISO date (YYYY-MM-DD), got "${text}".`);
  }
  return text;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ThresholdCatalogError(`${path}: expected a finite number, got ${describe(value)}.`);
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ThresholdCatalogError(`${path}: expected a boolean, got ${describe(value)}.`);
  }
  return value;
}

function asMember<T extends string>(
  value: unknown,
  allowed: readonly string[],
  path: string,
): T {
  const text = asString(value, path);
  if (!allowed.includes(text)) {
    throw new ThresholdCatalogError(
      `${path}: expected one of ${allowed.join(', ')}; got "${text}".`,
    );
  }
  return text as T;
}

function asOptionalStringArray(value: unknown, path: string): readonly string[] {
  if (value === undefined || value === null) return [];
  return asArray(value, path).map((entry, index) => asString(entry, `${path}[${index}]`));
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}
