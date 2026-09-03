import assert from 'node:assert/strict';
import { test } from 'node:test';

import { observedAcres } from './land-unit.ts';
import {
  compareScenarios,
  evaluateScenario,
  statusQuoScenario,
  subdivisionScenario,
} from './scenario.ts';
import type { ComparisonRow } from './scenario.ts';
import { FIXTURE_CATALOG, homeFarmHolding } from '../testing/fixtures.ts';

function row(rows: readonly ComparisonRow[], enterprise: string): ComparisonRow {
  const found = rows.find((candidate) => candidate.enterprise === enterprise);
  assert.ok(found !== undefined, `expected a row for ${enterprise}`);
  return found;
}

const holding = homeFarmHolding();
const baseline = evaluateScenario(statusQuoScenario(holding), FIXTURE_CATALOG);

test('the status quo scenario forecloses nothing and protects nothing', () => {
  const scenario = statusQuoScenario(holding);

  assert.equal(scenario.kind, 'status-quo');
  assert.equal(scenario.units.length, 1);
  assert.ok(scenario.irreversibility.length > 0);
});

test('subdividing one unit leaves the rest of the holding intact', () => {
  const twoUnitHolding = {
    ...holding,
    units: [
      ...holding.units,
      { ...holding.units[0]!, id: 'back-forty', label: 'Back forty' },
    ],
  };

  const scenario = subdivisionScenario({
    holding: twoUnitHolding,
    unitId: 'home-farm',
    plan: { method: 'equal-acreage', shares: 3 },
  });

  assert.equal(scenario.units.length, 4);
  assert.ok(scenario.units.some((unit) => unit.id === 'back-forty'));
});

test('subdividing a unit that is not in the holding is an error', () => {
  assert.throws(
    () =>
      subdivisionScenario({
        holding,
        unitId: 'not-ours',
        plan: { method: 'equal-acreage', shares: 2 },
      }),
    /is not part of holding/,
  );
});

test('a four-way split loses row crop and says so in the comparison', () => {
  const split = evaluateScenario(
    subdivisionScenario({
      holding,
      unitId: 'home-farm',
      plan: { method: 'equal-acreage', shares: 4 },
    }),
    FIXTURE_CATALOG,
  );

  const comparison = compareScenarios(baseline, [split]);
  const rowCrop = row(comparison.rows, 'row-crop');

  assert.equal(rowCrop.baselineStatus, 'supported');
  assert.equal(rowCrop.cells[0]?.status, 'not-supported');
  assert.equal(rowCrop.cells[0]?.verdict, 'lost');
  assert.deepEqual(comparison.lostByScenario.get(split.scenario.id), ['row-crop']);
});

test('an enterprise that survives on one share survives for the holding', () => {
  const split = evaluateScenario(
    subdivisionScenario({
      holding,
      unitId: 'home-farm',
      plan: {
        method: 'explicit',
        rationale: 'field-boundaries',
        shares: [
          {
            label: 'North field',
            acres: 120,
            soils: holding.units[0]!.soils.map((soil) => ({ ...soil, acres: soil.acres * (2 / 3) })),
            contiguousAcres: observedAcres(120),
            contiguousTillableAcres: observedAcres(100),
            waterAccess: 'year-round',
          },
          {
            label: 'South corner',
            acres: 60,
            soils: holding.units[0]!.soils.map((soil) => ({ ...soil, acres: soil.acres / 3 })),
            contiguousAcres: observedAcres(60),
            contiguousTillableAcres: observedAcres(20),
            waterAccess: 'none',
          },
        ],
      },
    }),
    FIXTURE_CATALOG,
  );

  const outlook = split.outlook.find((candidate) => candidate.enterprise === 'row-crop');
  assert.equal(outlook?.status, 'supported');
  assert.deepEqual(outlook?.supportedOn, ['home-farm-share-1']);

  const comparison = compareScenarios(baseline, [split]);
  assert.equal(row(comparison.rows, 'row-crop').cells[0]?.verdict, 'retained');
});

test('an enterprise the baseline never supported is not reported as a loss', () => {
  const split = evaluateScenario(
    subdivisionScenario({
      holding,
      unitId: 'home-farm',
      plan: { method: 'equal-acreage', shares: 8 },
    }),
    FIXTURE_CATALOG,
  );

  const comparison = compareScenarios(baseline, [split]);
  const lost = comparison.lostByScenario.get(split.scenario.id) ?? [];

  assert.ok(!lost.includes('vegetable'), 'vegetable was only ever supported with investment');
  assert.equal(row(comparison.rows, 'vegetable').cells[0]?.verdict, 'uncertain');
});

test('every scenario answers the same five questions', () => {
  const scenarios = [
    statusQuoScenario(holding),
    subdivisionScenario({
      holding,
      unitId: 'home-farm',
      plan: { method: 'equal-acreage', shares: 2 },
    }),
  ];

  for (const scenario of scenarios) {
    assert.ok(scenario.irreversibility.length > 0, `${scenario.id} states what is irreversible`);
    assert.ok(scenario.costs.length > 0, `${scenario.id} states what it costs`);
    assert.ok(scenario.timeline.length > 0, `${scenario.id} states a timeline`);
    assert.ok(scenario.referrals.length > 0, `${scenario.id} says who to call next`);
    for (const referral of scenario.referrals) {
      assert.match(referral.question, /\?$/, 'referrals are phrased as questions');
    }
  }
});
