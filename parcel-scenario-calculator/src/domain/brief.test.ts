import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BRIEF_SCHEMA_VERSION, buildBrief, DISCLAIMERS } from './brief.ts';
import { findFragmentationThresholds } from './fragmentation.ts';
import {
  compareScenarios,
  evaluateScenario,
  statusQuoScenario,
  subdivisionScenario,
} from './scenario.ts';
import { FIXTURE_CATALOG, homeFarmHolding } from '../testing/fixtures.ts';

function brief() {
  const holding = homeFarmHolding();
  const baseline = evaluateScenario(statusQuoScenario(holding), FIXTURE_CATALOG);
  const split = evaluateScenario(
    subdivisionScenario({
      holding,
      unitId: 'home-farm',
      plan: { method: 'equal-acreage', shares: 4 },
    }),
    FIXTURE_CATALOG,
  );

  return buildBrief({
    holding,
    catalog: FIXTURE_CATALOG,
    baseline,
    scenarios: [split],
    comparison: compareScenarios(baseline, [split]),
    fragmentation: [findFragmentationThresholds(holding.units[0]!, FIXTURE_CATALOG)],
    generatedAt: '2026-09-02T15:00:00Z',
  });
}

test('the brief serializes to JSON without loss', () => {
  const exported = brief();
  const roundTripped = JSON.parse(JSON.stringify(exported));

  assert.deepEqual(roundTripped, JSON.parse(JSON.stringify(exported)));
  assert.equal(roundTripped.schema, BRIEF_SCHEMA_VERSION);
  assert.equal(roundTripped.generatedAt, '2026-09-02T15:00:00Z');
});

test('the brief carries the disclaimers a renderer must not drop', () => {
  assert.deepEqual(brief().disclaimers, DISCLAIMERS);
  assert.ok(DISCLAIMERS.some((line) => line.includes('not legal, tax, financial, or appraisal advice')));
});

test('the brief discloses the threshold version and its unverified status', () => {
  const exported = brief();

  assert.equal(exported.catalog.version, FIXTURE_CATALOG.version);
  assert.equal(exported.catalog.unverifiedThresholds, true);
});

test('the brief names the soil survey behind its figures', () => {
  const exported = brief();

  assert.equal(exported.sources.length, 1);
  assert.equal(exported.sources[0]?.vintage, '2026');
});

test('the comparison survives export as an array, not a Map', () => {
  const exported = JSON.parse(JSON.stringify(brief()));

  assert.deepEqual(exported.comparison.lostByScenario, [
    { scenarioId: 'subdivision-4', enterprises: ['row-crop'] },
  ]);
});

test('the brief reports the holding acreage it analysed', () => {
  const exported = brief();

  assert.equal(exported.holding.acres, 180);
  assert.equal(exported.holding.units.length, 1);
});

test('the fragmentation ladder travels with the brief', () => {
  const exported = JSON.parse(JSON.stringify(brief()));
  const rowCrop = exported.fragmentation[0].thresholds.find(
    (threshold: { enterprise: string }) => threshold.enterprise === 'row-crop',
  );

  assert.equal(rowCrop.maxSharesSupported, 3);
});
