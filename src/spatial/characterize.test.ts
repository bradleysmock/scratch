import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { loadThresholdCatalog } from '../data/catalog.ts';
import { findFragmentationThresholds } from '../domain/fragmentation.ts';
import { summarizeSoils } from '../domain/soil.ts';
import {
  bracketContiguity,
  characterizeLandUnit,
  toSoilObservation,
  type SoilRow,
} from './characterize.ts';
import { METRIC_SRID, SQUARE_METRES_PER_ACRE } from './constants.ts';
import { closePool, isDatabaseConfigured, queryOne } from './db.ts';

/**
 * The spatial tests need PostgreSQL with PostGIS and the Phase 1b fixture
 * loaded. They skip without it, so the domain suite still passes on a machine
 * with no database — the dependency rule in backend spec §1 cuts both ways.
 */
const needsDb = { skip: isDatabaseConfigured() ? false : 'PSC_DATABASE_URL is not set' };

const FIXTURE_LAND_UNIT = '22222222-2222-4222-8222-222222222222';
const VERSIONS = [1, 2, 3, 4, 5, 6];

after(async () => {
  await closePool();
});

test('the acre is exactly the international acre', () => {
  assert.equal(SQUARE_METRES_PER_ACRE, 4046.8564224);
});

test('SQL and TypeScript agree on the acre and the metric projection', needsDb, async () => {
  const row = await queryOne<{ acre: number; srid: number }>(
    'select reference.square_metres_per_acre()::float8 as acre, reference.metric_srid() as srid',
  );

  assert.equal(row.acre, SQUARE_METRES_PER_ACRE);
  assert.equal(row.srid, METRIC_SRID);
});

test('the fixture holding measures the acreage it was constructed to be', needsDb, async () => {
  const { landUnit } = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
  });

  // 800 m x 910 m = 728,000 m² = 179.88 ac, by construction.
  assert.ok(Math.abs(landUnit.acres - 179.88) < 0.05, `got ${landUnit.acres}`);
  assert.equal(landUnit.contiguousAcres.basis, 'observed');
});

test('soil attachment accounts for the whole parcel', needsDb, async () => {
  const { landUnit, unattributedAcres } = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
  });

  assert.equal(landUnit.soils.length, 4);
  const attributed = landUnit.soils.reduce((total, soil) => total + soil.acres, 0);
  assert.ok(Math.abs(attributed - landUnit.acres) < 0.05, `attributed ${attributed}`);
  assert.ok(unattributedAcres < 0.05, `unattributed ${unattributedAcres}`);
});

test('prime farmland percentage comes through the domain unchanged', needsDb, async () => {
  const { landUnit } = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
  });
  const summary = summarizeSoils(landUnit.soils, landUnit.soilSource);

  // CX-1 loam is the only unconditionally prime unit: 532,400 m² of 728,000.
  assert.ok(Math.abs(summary.primePercent.value - 73.1) < 0.2, `got ${summary.primePercent.value}`);
  // CX-2 silt is prime only if drained, and is reported separately.
  assert.ok(summary.conditionallyPrimeAcres.value > 17);
});

test('every attached soil figure carries the survey vintage', needsDb, async () => {
  const { landUnit } = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
  });

  assert.match(landUnit.soilSource.dataset, /SSURGO/);
  assert.equal(landUnit.soilSource.vintage, 'constructed-2026-10');
});

test('a connection survives erosion if and only if it is wider than twice the gap', needsDb, async () => {
  // The fixture's headland is 8 m wide, so the break is at a 4 m gap.
  const permissive = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
    gapMetres: 3,
  });
  const strict = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
    gapMetres: 5,
  });

  assert.equal(permissive.contiguityMethod.blockCount, 1);
  assert.equal(strict.contiguityMethod.blockCount, 2);
  assert.ok((permissive.landUnit.contiguousTillableAcres?.acres ?? 0) > 138);
  assert.ok((strict.landUnit.contiguousTillableAcres?.acres ?? 0) < 87);
});

test('a pond inside a field is a hole, not a division of the block', needsDb, async () => {
  const { contiguityMethod, tillableAcres } = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
    gapMetres: 2,
  });

  assert.equal(contiguityMethod.blockCount, 1);
  // The 2,400 m² pond and the 40,000 m² woodlot are both out of the tillable
  // extent: 560,000 m² of the 728,000 m² parcel remains.
  assert.ok(Math.abs(tillableAcres - 138.38) < 0.05, `got ${tillableAcres}`);
});

test('the contiguity figure records the parameters that produced it', needsDb, async () => {
  const { landUnit, contiguityMethod } = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
    datasetVersionIds: VERSIONS,
    gapMetres: 5,
  });

  assert.equal(contiguityMethod.gapMetres, 5);
  assert.equal(contiguityMethod.tillableSource, 'cultivated-mask');
  assert.match(String(landUnit.contiguousTillableAcres?.note), /5 m erosion gap/);
  assert.match(String(landUnit.contiguousTillableAcres?.note), /confirm them on the ground/);
});

test('the fixture parcel is flagged crossing-dependent', needsDb, async () => {
  const bracket = await bracketContiguity(FIXTURE_LAND_UNIT, { datasetVersionIds: VERSIONS });

  assert.equal(bracket.crossingDependent, true);
  assert.ok(bracket.permissive.acres > bracket.strict.acres);
  assert.ok(bracket.spread > 0.3, `spread ${bracket.spread}`);
});

test('the erosion gap moves the row-crop fragmentation threshold by a whole share', needsDb, async () => {
  const catalog = loadThresholdCatalog();
  const thresholdAt = async (gapMetres: number): Promise<number | null> => {
    const { landUnit } = await characterizeLandUnit(FIXTURE_LAND_UNIT, {
      datasetVersionIds: VERSIONS,
      gapMetres,
    });
    const report = findFragmentationThresholds(landUnit, catalog, { maxShares: 8 });
    return (
      report.thresholds.find((threshold) => threshold.enterprise === 'row-crop')
        ?.maxSharesSupported ?? null
    );
  };

  // This is the Phase 1b finding, pinned as a test: the advice a landowner
  // receives depends on a parameter nobody has calibrated.
  assert.equal(await thresholdAt(3), 3);
  assert.equal(await thresholdAt(5), 2);
});

test('a map unit missing a drainage class is an error, not a default', () => {
  const row: SoilRow = {
    map_unit_symbol: 'CX-9',
    map_unit_name: 'Unnormalized unit',
    slope_percent: 4,
    drainage_class: null,
    nccpi: 0.4,
    hydric: false,
    farmland_class: 'prime',
    aggregation_method: 'dominant-condition',
    acres: 20,
  };

  assert.throws(
    () => toSoilObservation(row, 'Home farm'),
    /CX-9 on "Home farm" is missing drainage class/,
  );
});

test('a well-formed row maps straight onto a domain observation', () => {
  const observation = toSoilObservation(
    {
      map_unit_symbol: 'CX-1',
      map_unit_name: 'Constructed loam',
      slope_percent: 3,
      drainage_class: 'well drained',
      nccpi: 0.6,
      hydric: false,
      farmland_class: 'prime',
      aggregation_method: 'dominant-condition',
      acres: 131.5,
    },
    'Home farm',
  );

  assert.equal(observation.drainageClass, 'well drained');
  assert.equal(observation.nccpi, 0.6);
  assert.equal(observation.acres, 131.5);
});

test('an unrated map unit keeps its null NCCPI', () => {
  const observation = toSoilObservation(
    {
      map_unit_symbol: 'CX-3',
      map_unit_name: 'Constructed muck',
      slope_percent: 1,
      drainage_class: 'very poorly drained',
      nccpi: null,
      hydric: true,
      farmland_class: 'not-prime',
      aggregation_method: 'dominant-condition',
      acres: 8.5,
    },
    'Home farm',
  );

  assert.equal(observation.nccpi, null);
  assert.equal(observation.hydric, true);
});
