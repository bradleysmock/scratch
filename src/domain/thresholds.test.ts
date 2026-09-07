import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadThresholdCatalog } from '../data/catalog.ts';
import { applyOverride, findRequirement, hasUnverifiedThresholds } from './enterprise.ts';
import { parseThresholdCatalog, ThresholdCatalogError } from './thresholds.ts';
import { SPEC_ENTERPRISE_IDS } from './enterprise.ts';

function validCatalog(): Record<string, unknown> {
  return {
    version: 'test/1',
    effectiveFrom: '2026-01-01',
    publisher: 'Test',
    requirements: [
      {
        id: 'hay',
        label: 'Hay',
        landBase: 'tillable',
        minimumContiguousAcres: 10,
        drainageTolerance: { wettest: 'poorly drained', driest: 'well drained' },
        maxSlopePercent: 12,
        waterAccess: 'not-required',
        fencing: 'not-required',
        minimumProductivityIndex: 0.25,
        remediation: { drainageByTile: true, fencingInstallable: false },
        citation: { status: 'verified', source: 'Somewhere', reference: 'Table 3' },
      },
    ],
  };
}

function withRequirement(patch: Record<string, unknown>): Record<string, unknown> {
  const catalog = validCatalog();
  const requirements = catalog['requirements'] as Record<string, unknown>[];
  return { ...catalog, requirements: [{ ...requirements[0], ...patch }] };
}

test('the shipped catalog parses and covers every enterprise the spec names', () => {
  const catalog = loadThresholdCatalog();

  for (const id of SPEC_ENTERPRISE_IDS) {
    assert.ok(findRequirement(catalog, id) !== undefined, `catalog defines ${id}`);
  }
});

test('every threshold shipped today is disclosed as unverified', () => {
  const catalog = loadThresholdCatalog();

  assert.equal(hasUnverifiedThresholds(catalog), true);
  for (const requirement of catalog.requirements) {
    assert.equal(
      requirement.citation.status,
      'unverified-placeholder',
      `${requirement.id} must not claim a source it does not have`,
    );
  }
});

test('a valid catalog round-trips its fields', () => {
  const catalog = parseThresholdCatalog(validCatalog());

  assert.equal(catalog.version, 'test/1');
  assert.equal(catalog.requirements[0]?.citation.reference, 'Table 3');
  assert.deepEqual(catalog.overrides, []);
});

test('optional citation fields are omitted rather than set to null', () => {
  const catalog = parseThresholdCatalog(validCatalog());

  assert.equal('note' in (catalog.requirements[0]?.citation ?? {}), false);
});

test('an inverted drainage window is rejected', () => {
  assert.throws(
    () =>
      parseThresholdCatalog(
        withRequirement({
          drainageTolerance: { wettest: 'well drained', driest: 'poorly drained' },
        }),
      ),
    /window is inverted/,
  );
});

test('an unknown drainage class is rejected with the allowed values', () => {
  assert.throws(
    () =>
      parseThresholdCatalog(
        withRequirement({ drainageTolerance: { wettest: 'soggy', driest: 'well drained' } }),
      ),
    /expected one of/,
  );
});

test('a productivity floor outside 0–1 is rejected', () => {
  assert.throws(
    () => parseThresholdCatalog(withRequirement({ minimumProductivityIndex: 45 })),
    /between 0 and 1/,
  );
});

test('a null productivity floor means the criterion does not apply', () => {
  const catalog = parseThresholdCatalog(withRequirement({ minimumProductivityIndex: null }));

  assert.equal(catalog.requirements[0]?.minimumProductivityIndex, null);
});

test('a zero or negative acreage floor is rejected', () => {
  assert.throws(
    () => parseThresholdCatalog(withRequirement({ minimumContiguousAcres: 0 })),
    /greater than zero/,
  );
});

test('duplicate enterprise ids are rejected', () => {
  const catalog = validCatalog();
  const requirements = catalog['requirements'] as unknown[];
  assert.throws(
    () => parseThresholdCatalog({ ...catalog, requirements: [...requirements, ...requirements] }),
    /duplicate enterprise ids hay/,
  );
});

test('a malformed effective date is rejected', () => {
  assert.throws(
    () => parseThresholdCatalog({ ...validCatalog(), effectiveFrom: 'Sept 2026' }),
    ThresholdCatalogError,
  );
});

test('an empty catalog is rejected rather than quietly supporting nothing', () => {
  assert.throws(
    () => parseThresholdCatalog({ ...validCatalog(), requirements: [] }),
    /defines no enterprises/,
  );
});

test('an advisor override replaces the threshold and records who changed it', () => {
  const catalog = parseThresholdCatalog(validCatalog());
  const overridden = applyOverride(catalog, {
    enterprise: 'hay',
    field: 'minimumContiguousAcres',
    value: 4,
    by: 'A. Advisor, Washtenaw CD',
    reason: 'Small-square baling for the horse market works well below ten acres here.',
    at: '2026-09-02T14:00:00Z',
  });

  assert.equal(findRequirement(overridden, 'hay')?.minimumContiguousAcres, 4);
  assert.equal(overridden.overrides[0]?.previousValue, 10);
  assert.equal(overridden.overrides[0]?.override.by, 'A. Advisor, Washtenaw CD');
});

test('an override does not mutate the catalog it came from', () => {
  const catalog = parseThresholdCatalog(validCatalog());
  applyOverride(catalog, {
    enterprise: 'hay',
    field: 'maxSlopePercent',
    value: 20,
    by: 'A. Advisor',
    reason: 'Local balers work steeper ground.',
    at: '2026-09-02T14:00:00Z',
  });

  assert.equal(findRequirement(catalog, 'hay')?.maxSlopePercent, 12);
  assert.deepEqual(catalog.overrides, []);
});

test('an override marks the threshold as no longer resting on its citation', () => {
  const catalog = parseThresholdCatalog(validCatalog());
  const overridden = applyOverride(catalog, {
    enterprise: 'hay',
    field: 'drainageTolerance',
    value: { wettest: 'very poorly drained', driest: 'well drained' },
    by: 'A. Advisor',
    reason: 'Wet meadow hay is cut here in dry years.',
    at: '2026-09-02T14:00:00Z',
  });

  assert.equal(hasUnverifiedThresholds(catalog), false);
  assert.equal(hasUnverifiedThresholds(overridden), true);
  assert.match(String(findRequirement(overridden, 'hay')?.citation.source), /Advisor override/);
});

test('overriding an enterprise the catalog does not define is an error', () => {
  const catalog = parseThresholdCatalog(validCatalog());

  assert.throws(
    () =>
      applyOverride(catalog, {
        enterprise: 'aquaculture',
        field: 'maxSlopePercent',
        value: 1,
        by: 'A. Advisor',
        reason: 'Ponds are flat.',
        at: '2026-09-02T14:00:00Z',
      }),
    /unknown enterprise/,
  );
});
