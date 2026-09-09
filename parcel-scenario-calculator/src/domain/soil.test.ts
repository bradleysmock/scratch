import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeSoils, MIN_PRODUCTIVITY_COVERAGE } from './soil.ts';
import {
  FIXTURE_SOILS,
  FIXTURE_SOIL_SOURCE,
  HYDRIC_MUCK,
  SOMEWHAT_POORLY_SILT,
  WELL_DRAINED_LOAM,
} from '../testing/fixtures.ts';

test('prime farmland percentage counts only unconditionally prime acres', () => {
  const summary = summarizeSoils(FIXTURE_SOILS, FIXTURE_SOIL_SOURCE);

  assert.equal(summary.mappedAcres.value, 180);
  assert.equal(summary.primeAcres.value, 120);
  assert.equal(summary.conditionallyPrimeAcres.value, 30);
  assert.ok(Math.abs(summary.primePercent.value - 66.67) < 0.01);
  assert.ok(Math.abs(summary.primeIncludingConditionalPercent.value - 83.33) < 0.01);
});

test('the optimistic prime percentage is labelled as an assumption', () => {
  const summary = summarizeSoils(FIXTURE_SOILS, FIXTURE_SOIL_SOURCE);

  assert.equal(summary.primeIncludingConditionalPercent.basis, 'assumed');
  assert.ok(summary.primeIncludingConditionalPercent.assumptions.length > 0);
});

test('every derived figure carries the survey source', () => {
  const summary = summarizeSoils(FIXTURE_SOILS, FIXTURE_SOIL_SOURCE);

  for (const derived of Object.values(summary)) {
    assert.deepEqual(derived.sources, [FIXTURE_SOIL_SOURCE]);
    assert.ok(derived.method.length > 0, 'each figure explains how it was computed');
  }
});

test('productivity index is acreage-weighted over rated map units only', () => {
  const summary = summarizeSoils(FIXTURE_SOILS, FIXTURE_SOIL_SOURCE);

  // (120 * 0.60 + 30 * 0.45 + 10 * 0.20) / 160 rated acres
  assert.ok(summary.productivityIndex.value !== null);
  assert.ok(Math.abs((summary.productivityIndex.value as number) - 0.546875) < 1e-9);
  assert.ok(Math.abs(summary.productivityCoverage.value - 160 / 180) < 1e-9);
});

test('an unrated map unit is not treated as unproductive', () => {
  const ratedOnly = summarizeSoils([WELL_DRAINED_LOAM], FIXTURE_SOIL_SOURCE);
  const withUnrated = summarizeSoils([WELL_DRAINED_LOAM, HYDRIC_MUCK], FIXTURE_SOIL_SOURCE);

  assert.equal(withUnrated.productivityIndex.value, ratedOnly.productivityIndex.value);
});

test('productivity index is indeterminate below the coverage floor', () => {
  const mostlyUnrated = summarizeSoils(
    [
      { ...WELL_DRAINED_LOAM, acres: 10 },
      { ...HYDRIC_MUCK, acres: 90 },
    ],
    FIXTURE_SOIL_SOURCE,
  );

  assert.equal(mostlyUnrated.productivityIndex.value, null);
  assert.equal(mostlyUnrated.productivityIndex.basis, 'unknown');
  assert.ok(mostlyUnrated.productivityCoverage.value < MIN_PRODUCTIVITY_COVERAGE);
  assert.match(String(mostlyUnrated.productivityIndex.assumptions[0]), /coverage floor/);
});

test('drainage composition is ordered wettest first and omits absent classes', () => {
  const summary = summarizeSoils(
    [WELL_DRAINED_LOAM, SOMEWHAT_POORLY_SILT, HYDRIC_MUCK],
    FIXTURE_SOIL_SOURCE,
  );

  assert.deepEqual(summary.drainageComposition.value, [
    { drainageClass: 'very poorly drained', acres: 20 },
    { drainageClass: 'somewhat poorly drained', acres: 30 },
    { drainageClass: 'well drained', acres: 120 },
  ]);
});

test('an empty soil set yields indeterminate slope rather than zero', () => {
  const summary = summarizeSoils([], FIXTURE_SOIL_SOURCE);

  assert.equal(summary.maxSlopePercent.value, null);
  assert.equal(summary.mappedAcres.value, 0);
  assert.equal(summary.primePercent.value, 0);
});
