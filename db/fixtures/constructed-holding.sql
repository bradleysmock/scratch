-- Phase 1b fixture: a CONSTRUCTED holding. Not real data.
--
-- No parcel, soil, or overlay geometry here corresponds to any real property or
-- published survey. Real SSURGO and county parcel data could not be reached
-- from the build environment, and inventing a plausible-looking Washtenaw
-- parcel and reporting figures from it would be worse than useless.
--
-- What this fixture IS for: exercising the contiguity computation against the
-- geometry that makes it hard. It is laid out deliberately so that two tillable
-- blocks are joined by a single 8-metre headland crossing a wet swale — the
-- case the erode-dump-dilate step in backend spec §5.4 exists to handle, and
-- the case that decides whether the fragmentation threshold is 2 shares or 3.
--
-- Coordinates are built in EPSG:5070 metres around an origin that falls in
-- Washtenaw County, Michigan, so distances and areas are exact by construction
-- and the figures below are arithmetic, not estimates:
--
--   holding          800 m x 910 m        728,000 m²   179.88 ac
--   east steep strip 100 m x 910 m         91,000 m²    22.49 ac  (18% slope)
--   wet swale        700 m x  50 m         35,000 m²     8.65 ac  (hydric)
--   headland           8 m x  50 m            400 m²     0.10 ac  <-- the hinge
--   woodlot          200 m x 200 m         40,000 m²     9.88 ac  (uncultivated)
--   pond              60 m x  40 m          2,400 m²     0.59 ac
--
--   tillable, total                       560,000 m²   138.38 ac
--   tillable, north block                 210,000 m²    51.89 ac
--   tillable, south block                 349,600 m²    86.39 ac

begin;

truncate working.land_unit_parcel, working.characterization, working.land_unit,
         working.holding cascade;
truncate reference.soil_map_unit, reference.overlay, reference.parcel cascade;
delete from reference.dataset_version;

-- Dataset versions. Provenance is honest about what this is: a constructed
-- fixture, not a vintage of anything.
insert into reference.dataset_version
  (id, dataset, scope, vintage, source_url, retrieved_at, checksum, review_by)
values
  (1, 'ssurgo', 'CONSTRUCTED', 'constructed-2026-10',
   'constructed://phase-1b-fixture', '2026-10-24T00:00:00Z', 'n/a', '2027-10-24'),
  (2, 'parcel', 'CONSTRUCTED', 'constructed-2026-10',
   'constructed://phase-1b-fixture', '2026-10-24T00:00:00Z', 'n/a', '2027-10-24'),
  (3, 'nwi', 'CONSTRUCTED', 'constructed-2026-10',
   'constructed://phase-1b-fixture', '2026-10-24T00:00:00Z', 'n/a', '2027-10-24'),
  (4, 'nhd', 'CONSTRUCTED', 'constructed-2026-10',
   'constructed://phase-1b-fixture', '2026-10-24T00:00:00Z', 'n/a', '2027-10-24'),
  (5, 'cdl', 'CONSTRUCTED', 'constructed-2026-10',
   'constructed://phase-1b-fixture', '2026-10-24T00:00:00Z', 'n/a', '2027-10-24'),
  (6, 'fema-nfhl', 'CONSTRUCTED', 'constructed-2026-10',
   'constructed://phase-1b-fixture', '2026-10-24T00:00:00Z', 'n/a', '2027-10-24');
select setval(pg_get_serial_sequence('reference.dataset_version', 'id'), 6);

-- Local frame: rect(x1, y1, x2, y2) in metres from the origin, in EPSG:5070.
--
-- Every boolean construction below happens in this one metric frame and is
-- transformed to storage SRID exactly once, in multi(). This is not fussiness:
-- a line of constant northing in Albers is not a line of constant latitude, so
-- transforming two rectangles independently leaves edges that ought to coincide
-- very slightly apart. The first version of this fixture did that, and a
-- sub-millimetre wedge severed the 8 m headland — the computation was right and
-- the fixture was lying to it. The same hazard applies to real ETL input
-- (backend spec §8): transform once, then node.
create or replace function pg_temp.rect(
  x1 double precision, y1 double precision,
  x2 double precision, y2 double precision
) returns geometry language sql immutable as $$
  select st_makeenvelope(998800 + x1, 2204300 + y1, 998800 + x2, 2204300 + y2, 5070)
$$;

create or replace function pg_temp.multi(g geometry)
  returns geometry language sql immutable as $$
  select st_multi(st_collectionextract(st_makevalid(st_transform(g, 4326)), 3))
$$;

-- Two parcels, which the land unit will be assembled from.
insert into reference.parcel
  (dataset_version_id, county_fips, parcel_pin, situs_address, acres_assessed, geom)
values
  (2, '26161', 'CONSTRUCTED-N', '0000 Constructed Road', 118.61,
   pg_temp.multi(pg_temp.rect(0, 310, 800, 910))),
  (2, '26161', 'CONSTRUCTED-S', '0000 Constructed Road', 61.28,
   pg_temp.multi(pg_temp.rect(0, 0, 800, 310)));

-- Soil map units. Vocabularies match src/domain/soil.ts. The headland strip is
-- upland loam, which is what makes it a crossing rather than a barrier.
insert into reference.soil_map_unit
  (dataset_version_id, mukey, map_unit_symbol, map_unit_name, slope_percent,
   drainage_class, nccpi, hydric, farmland_class, aggregation_method, geom)
values
  (1, 'CX001', 'CX-1', 'Constructed loam, 0 to 4 percent slopes', 3.0,
   'well drained', 0.600, false, 'prime', 'dominant-condition',
   pg_temp.multi(
     st_union(
       st_difference(pg_temp.rect(0, 0, 700, 910), pg_temp.rect(0, 460, 700, 610)),
       pg_temp.rect(360, 560, 368, 610)
     )
   )),
  (1, 'CX002', 'CX-2', 'Constructed silt loam, 0 to 2 percent slopes', 2.0,
   'somewhat poorly drained', 0.450, false, 'prime-if-drained', 'dominant-condition',
   pg_temp.multi(pg_temp.rect(0, 460, 700, 560))),
  (1, 'CX003', 'CX-3', 'Constructed muck, 0 to 1 percent slopes', 1.0,
   'very poorly drained', null, true, 'not-prime', 'dominant-condition',
   pg_temp.multi(
     st_difference(pg_temp.rect(0, 560, 700, 610), pg_temp.rect(360, 560, 368, 610))
   )),
  (1, 'CX004', 'CX-4', 'Constructed sandy loam, 12 to 25 percent slopes', 18.0,
   'somewhat excessively drained', 0.200, false, 'not-prime', 'dominant-condition',
   pg_temp.multi(pg_temp.rect(700, 0, 800, 910)));

-- Overlays.
insert into reference.overlay (dataset_version_id, layer, classification, geom)
values
  -- The swale: wetland everywhere except the 8 m crossing.
  (3, 'wetland', 'PEM1C',
   pg_temp.multi(
     st_difference(pg_temp.rect(0, 560, 700, 610), pg_temp.rect(360, 560, 368, 610))
   )),
  -- A pond inside the south field: a hole in the block, not a division of it.
  (4, 'hydrography', 'pond',
   pg_temp.multi(pg_temp.rect(500, 100, 560, 140))),
  (6, 'floodplain', 'AE',
   pg_temp.multi(pg_temp.rect(0, 520, 700, 650))),
  -- Cultivated mask, as a 30 m raster would be vectorized. Everything but the
  -- woodlot and the swale. Note what this cannot do: an 8 m crossing is far
  -- below the resolution of the real CDL, so on real data this mask could not
  -- settle whether the crossing is there at all.
  (5, 'cultivated', 'cultivated',
   pg_temp.multi(
     st_difference(
       st_difference(pg_temp.rect(0, 0, 800, 910), pg_temp.rect(0, 0, 200, 200)),
       st_difference(pg_temp.rect(0, 560, 700, 610), pg_temp.rect(360, 560, 368, 610))
     )
   ));

-- The holding and its single land unit, assembled from both parcels.
insert into working.holding (id, label)
values ('11111111-1111-4111-8111-111111111111', 'Constructed holding (fixture)');

insert into working.land_unit
  (id, holding_id, label, origin, geom, water_access, fencing)
select
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Constructed home farm (fixture)',
  'parcel-selection',
  pg_temp.multi(st_unaryunion(st_collect(p.geom))),
  'year-round',
  'none'
from reference.parcel p
where p.parcel_pin in ('CONSTRUCTED-N', 'CONSTRUCTED-S');

insert into working.land_unit_parcel (land_unit_id, parcel_id)
select '22222222-2222-4222-8222-222222222222', p.id
from reference.parcel p
where p.parcel_pin in ('CONSTRUCTED-N', 'CONSTRUCTED-S');

commit;
