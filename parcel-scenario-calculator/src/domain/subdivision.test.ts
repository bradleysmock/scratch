import assert from 'node:assert/strict';
import { test } from 'node:test';

import { observedAcres } from './land-unit.ts';
import { subdivide, SubdivisionError } from './subdivision.ts';
import { evaluateUnit, enterpriseSet } from './viability.ts';
import {
  FIXTURE_CATALOG,
  WELL_DRAINED_LOAM,
  homeFarm,
} from '../testing/fixtures.ts';

test('an equal-acreage split divides acres and every map unit pro rata', () => {
  const { children } = subdivide(homeFarm(), { method: 'equal-acreage', shares: 4 });

  assert.equal(children.length, 4);
  for (const child of children) {
    assert.equal(child.acres, 45);
    assert.equal(child.soils.length, 4);
    assert.equal(child.soils[0]?.acres, 30);
    assert.equal(child.contiguousTillableAcres?.acres, 37.5);
  }
});

test('contiguous acreage after a split is stated as an upper bound', () => {
  const { children, assumptions } = subdivide(homeFarm(), { method: 'equal-acreage', shares: 3 });
  const child = children[0];

  assert.equal(child?.contiguousTillableAcres?.basis, 'estimated-upper-bound');
  assert.equal(child?.contiguousAcres.basis, 'estimated-upper-bound');
  assert.match(String(child?.contiguousTillableAcres?.note), /cannot exceed/);
  assert.ok(assumptions.some((note) => note.includes('upper bounds')));
});

test('a split cannot promise which share keeps the water', () => {
  const { children } = subdivide(homeFarm({ waterAccess: 'year-round' }), {
    method: 'equal-acreage',
    shares: 2,
  });

  assert.equal(children[0]?.waterAccess, 'unknown');
});

test('a parcel with no water anywhere still has none after a split', () => {
  const { children } = subdivide(homeFarm({ waterAccess: 'none' }), {
    method: 'equal-acreage',
    shares: 2,
  });

  assert.equal(children[0]?.waterAccess, 'none');
});

test('perimeter fencing becomes partial fencing on each share', () => {
  const { children } = subdivide(homeFarm({ fencing: 'perimeter' }), {
    method: 'equal-acreage',
    shares: 2,
  });

  assert.equal(children[0]?.fencing, 'partial');
});

test('a split below the row-crop acreage floor loses row crop', () => {
  const before = evaluateUnit(homeFarm(), FIXTURE_CATALOG);
  const { children } = subdivide(homeFarm(), { method: 'equal-acreage', shares: 4 });
  const after = evaluateUnit(children[0]!, FIXTURE_CATALOG);

  assert.ok(enterpriseSet(before).includes('row-crop'));
  assert.ok(!enterpriseSet(after).includes('row-crop'));
});

test('a retained enterprise on an estimated share is marked provisional', () => {
  const { children } = subdivide(homeFarm(), { method: 'equal-acreage', shares: 2 });
  const hay = evaluateUnit(children[0]!, FIXTURE_CATALOG).enterprises.find(
    (enterprise) => enterprise.enterprise === 'hay',
  );

  assert.equal(hay?.status, 'supported');
  assert.equal(hay?.reliesOnEstimate, true);
});

test('fewer than two shares is not a subdivision', () => {
  assert.throws(
    () => subdivide(homeFarm(), { method: 'equal-acreage', shares: 1 }),
    SubdivisionError,
  );
  assert.throws(
    () => subdivide(homeFarm(), { method: 'equal-acreage', shares: 2.5 }),
    SubdivisionError,
  );
});

test('an explicit split keeps the acreages the advisor supplied', () => {
  const { children, method } = subdivide(homeFarm(), {
    method: 'explicit',
    rationale: 'field-boundaries',
    shares: [
      {
        label: 'North field',
        acres: 100,
        soils: [{ ...WELL_DRAINED_LOAM, acres: 100 }],
        contiguousAcres: observedAcres(100),
        contiguousTillableAcres: observedAcres(95),
        waterAccess: 'none',
      },
      {
        label: 'South woods and creek',
        acres: 80,
        soils: [{ ...WELL_DRAINED_LOAM, acres: 20 }],
        contiguousAcres: observedAcres(80),
        contiguousTillableAcres: observedAcres(20),
        waterAccess: 'year-round',
      },
    ],
  });

  assert.equal(method, 'explicit');
  assert.equal(children[0]?.contiguousTillableAcres?.basis, 'observed');
  assert.equal(children[1]?.waterAccess, 'year-round');
});

test('explicit shares may not allocate more land than the parcel holds', () => {
  assert.throws(
    () =>
      subdivide(homeFarm(), {
        method: 'explicit',
        rationale: 'other',
        shares: [
          { label: 'A', acres: 120, soils: [], contiguousAcres: observedAcres(120) },
          { label: 'B', acres: 120, soils: [], contiguousAcres: observedAcres(120) },
        ],
      }),
    /more than the 180.00 acres/,
  );
});

test('a share cannot hold a contiguous block larger than itself', () => {
  assert.throws(
    () =>
      subdivide(homeFarm(), {
        method: 'explicit',
        rationale: 'other',
        shares: [
          { label: 'A', acres: 90, soils: [], contiguousAcres: observedAcres(120) },
          { label: 'B', acres: 90, soils: [], contiguousAcres: observedAcres(90) },
        ],
      }),
    /contiguous block within/,
  );
});

test('unallocated acres are disclosed rather than dropped silently', () => {
  const { assumptions } = subdivide(homeFarm(), {
    method: 'explicit',
    rationale: 'equal-value',
    shares: [
      { label: 'A', acres: 60, soils: [], contiguousAcres: observedAcres(60) },
      { label: 'B', acres: 60, soils: [], contiguousAcres: observedAcres(60) },
    ],
  });

  assert.ok(assumptions.some((note) => note.includes('60.0 acres') && note.includes('not allocated')));
  assert.ok(assumptions.some((note) => note.includes('valuation this tool does not perform')));
});
