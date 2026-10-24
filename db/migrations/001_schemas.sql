-- 001: extensions, schemas, and the one constant that must never drift.
--
-- Two schemas with a hard line between them (backend spec §4):
--   reference — owned by the ETL, read-only at request time
--   working   — owned by the app, never written by the ETL

create extension if not exists postgis;

create schema if not exists reference;
create schema if not exists working;

-- Exactly one acre, in square metres, by the international definition.
-- The TypeScript side defines the same number and a test asserts they agree
-- (backend spec §5.1). An acreage figure that differs between SQL and the
-- domain layer would be invisible and wrong in opposite directions.
create or replace function reference.square_metres_per_acre()
  returns double precision
  language sql immutable parallel safe
as $$ select 4046.8564224::double precision $$;

-- Every metric computation happens in EPSG:5070 (NAD83 / Conus Albers), the
-- equal-area projection NRCS uses for national soils work, so prime-farmland
-- percentages are computed the way the ACEP-ALE ranking criteria expect.
-- Storage stays in 4326.
create or replace function reference.metric_srid()
  returns integer
  language sql immutable parallel safe
as $$ select 5070 $$;

create or replace function reference.acres(geom geometry)
  returns double precision
  language sql immutable parallel safe
as $$
  select st_area(st_transform(geom, reference.metric_srid()))
       / reference.square_metres_per_acre()
$$;
