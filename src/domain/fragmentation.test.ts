import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findFragmentationThresholds } from './fragmentation.ts';
import type { FragmentationThreshold } from './fragmentation.ts';
import { FIXTURE_CATALOG, homeFarm } from '../testing/fixtures.ts';

const report = findFragmentationThresholds(homeFarm(), FIXTURE_CATALOG, { maxShares: 6 });

function threshold(enterprise: string): FragmentationThreshold {
  const found = report.thresholds.find((candidate) => candidate.enterprise === enterprise);
  assert.ok(found !== undefined, `expected a threshold for ${enterprise}`);
  return found;
}

test('row crop survives a three-way split of 150 tillable acres and not a four-way', () => {
  const rowCrop = threshold('row-crop');

  assert.equal(rowCrop.baselineStatus, 'supported');
  assert.equal(rowCrop.maxSharesSupported, 3);
  assert.equal(rowCrop.firstFailingShares, 4);
  assert.ok(
    rowCrop.blockingAtFailure.some((blocker) => blocker.criterion === 'minimum contiguous acreage'),
  );
});

test('the ladder records every share count tested', () => {
  const rowCrop = threshold('row-crop');

  assert.deepEqual(
    rowCrop.ladder.map((rung) => rung.shares),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    rowCrop.ladder.map((rung) => rung.status),
    [
      'supported',
      'supported',
      'supported',
      'not-supported',
      'not-supported',
      'not-supported',
    ],
  );
});

test('hay outlasts row crop, because it needs less contiguous ground', () => {
  assert.ok((threshold('hay').maxSharesSupported ?? 0) > (threshold('row-crop').maxSharesSupported ?? 0));
});

test('an enterprise that was never supported outright reports no threshold', () => {
  const grazing = threshold('managed-grazing');

  assert.equal(grazing.baselineStatus, 'supported-with-investment');
  assert.equal(grazing.maxSharesSupported, null);
  assert.equal(grazing.maxSharesSupportedWithInvestment, 1);
  assert.equal(grazing.firstFailingShares, 1);
});

test('a split that makes water unknowable stops the answer rather than guessing it', () => {
  const grazing = threshold('managed-grazing');
  const afterSplit = grazing.ladder.find((rung) => rung.shares === 2);

  assert.equal(afterSplit?.status, 'indeterminate');
  assert.ok(
    afterSplit?.blocking.some(
      (blocker) => blocker.criterion === 'water access' && blocker.status === 'indeterminate',
    ),
  );
});

test('the report carries the caveats that make its numbers readable', () => {
  assert.equal(report.unitId, 'home-farm');
  assert.equal(report.maxSharesTested, 6);
  assert.ok(report.caveats.some((caveat) => caveat.includes('upper bounds')));
});

test('a nonsensical share range is rejected', () => {
  assert.throws(
    () => findFragmentationThresholds(homeFarm(), FIXTURE_CATALOG, { maxShares: 0 }),
    /whole number of at least 1/,
  );
});
