import assert from 'node:assert/strict';
import { test } from 'node:test';

import { observedAcres } from './land-unit.ts';
import { summarizeSoils } from './soil.ts';
import { enterpriseSet, evaluateEnterprise, evaluateUnit } from './viability.ts';
import type { CriterionResult, EnterpriseViability } from './viability.ts';
import {
  FIXTURE_CATALOG,
  FIXTURE_SOIL_SOURCE,
  HYDRIC_MUCK,
  SOMEWHAT_POORLY_SILT,
  STEEP_SAND,
  WELL_DRAINED_LOAM,
  homeFarm,
} from '../testing/fixtures.ts';

function criterion(result: EnterpriseViability, name: string): CriterionResult {
  const found = result.criteria.find((candidate) => candidate.criterion === name);
  assert.ok(found !== undefined, `expected a "${name}" criterion`);
  return found;
}

function evaluate(unit = homeFarm(), enterprise = 'row-crop'): EnterpriseViability {
  const soils = summarizeSoils(unit.soils, unit.soilSource);
  return evaluateEnterprise(unit, soils, FIXTURE_CATALOG, enterprise);
}

test('the undivided home farm supports row crop, hay, and timber outright', () => {
  const viability = evaluateUnit(homeFarm(), FIXTURE_CATALOG);

  assert.deepEqual(enterpriseSet(viability), ['hay', 'row-crop', 'timber']);
});

test('an enterprise short only of fencing is supported with investment, not lost', () => {
  const grazing = evaluate(homeFarm(), 'managed-grazing');

  assert.equal(grazing.status, 'supported-with-investment');
  assert.equal(criterion(grazing, 'fencing').status, 'unmet-remediable');
});

test('existing perimeter fencing satisfies the fencing requirement outright', () => {
  const grazing = evaluate(homeFarm({ fencing: 'perimeter' }), 'managed-grazing');

  assert.equal(grazing.status, 'supported');
});

test('unknown water access yields indeterminate, never a default of none', () => {
  const grazing = evaluate(homeFarm({ waterAccess: 'unknown', fencing: 'perimeter' }), 'managed-grazing');

  assert.equal(grazing.status, 'indeterminate');
  assert.equal(criterion(grazing, 'water access').status, 'indeterminate');
});

test('seasonal water does not satisfy a year-round requirement', () => {
  const grazing = evaluate(homeFarm({ waterAccess: 'seasonal', fencing: 'perimeter' }), 'managed-grazing');

  assert.equal(grazing.status, 'not-supported');
  assert.equal(criterion(grazing, 'water access').status, 'unmet');
});

test('a hard shortfall outranks an unknown: slope decides even with water unrecorded', () => {
  const steepOnly = homeFarm({
    acres: 40,
    contiguousTillableAcres: observedAcres(40),
    waterAccess: 'unknown',
    soils: [{ ...STEEP_SAND, acres: 40 }],
  });

  // Vegetables need year-round water, which is unrecorded here — but the slope
  // settles the question regardless.
  const vegetable = evaluate(steepOnly, 'vegetable');
  assert.equal(criterion(vegetable, 'water access').status, 'indeterminate');
  assert.equal(criterion(vegetable, 'slope ceiling').status, 'unmet');
  assert.equal(vegetable.status, 'not-supported');
});

test('missing tillable acreage is reported as indeterminate, not as zero acres', () => {
  const rowCrop = evaluate(homeFarm({ contiguousTillableAcres: null }), 'row-crop');

  assert.equal(rowCrop.status, 'indeterminate');
  assert.equal(criterion(rowCrop, 'minimum contiguous acreage').status, 'indeterminate');
});

test('wet ground within reach of tile drainage is remediable, not lost', () => {
  const wet = homeFarm({
    acres: 60,
    contiguousTillableAcres: observedAcres(60),
    soils: [{ ...SOMEWHAT_POORLY_SILT, acres: 60 }],
  });

  // Vegetable tolerates only moderately-well-drained ground and up, but the
  // catalog allows tile drainage as a remedy on this enterprise.
  const vegetable = evaluate(wet, 'vegetable');
  assert.equal(criterion(vegetable, 'drainage class tolerance').status, 'unmet-remediable');
  assert.equal(vegetable.status, 'supported-with-investment');
});

test('hydric ground is never counted as tile-drainable', () => {
  const wetland = homeFarm({
    acres: 60,
    contiguousTillableAcres: observedAcres(60),
    soils: [{ ...HYDRIC_MUCK, acres: 60, nccpi: 0.5 }],
  });

  const rowCrop = evaluate(wetland, 'row-crop');
  assert.equal(criterion(rowCrop, 'drainage class tolerance').status, 'unmet');
  assert.equal(rowCrop.status, 'not-supported');
});

test('every result names its threshold version and flags unverified thresholds', () => {
  const rowCrop = evaluate();

  assert.equal(rowCrop.thresholdVersion, FIXTURE_CATALOG.version);
  assert.equal(rowCrop.thresholdUnverified, true);
});

test('an enterprise absent from the catalog is an error, not a silent skip', () => {
  const unit = homeFarm();
  const soils = summarizeSoils(unit.soils, FIXTURE_SOIL_SOURCE);

  assert.throws(
    () => evaluateEnterprise(unit, soils, FIXTURE_CATALOG, 'aquaculture'),
    /not defined in threshold catalog/,
  );
});

test('criteria explain both the requirement and the observation', () => {
  const rowCrop = evaluate();

  for (const result of rowCrop.criteria) {
    assert.ok(result.requirement.length > 0, `${result.criterion} states its requirement`);
    assert.ok(result.observed.length > 0, `${result.criterion} states what was observed`);
  }
  assert.equal(
    criterion(rowCrop, 'productivity index floor').observed.includes('0.55'),
    true,
  );
});

test('soil map units alone cannot make a parcel viable without soils attached', () => {
  const bare = homeFarm({ soils: [], contiguousTillableAcres: observedAcres(150) });
  const rowCrop = evaluate(bare, 'row-crop');

  assert.equal(rowCrop.status, 'indeterminate');
  assert.equal(criterion(rowCrop, 'drainage class tolerance').status, 'indeterminate');
  assert.equal(criterion(rowCrop, 'slope ceiling').status, 'indeterminate');
});

test('a well-drained loam block supports vegetables once fenced', () => {
  const garden = homeFarm({
    acres: 20,
    contiguousTillableAcres: observedAcres(20),
    soils: [{ ...WELL_DRAINED_LOAM, acres: 20 }],
    fencing: 'perimeter',
    waterAccess: 'year-round',
  });

  assert.equal(evaluate(garden, 'vegetable').status, 'supported');
});
