-- 002: reference schema — everything the ETL owns (backend spec §4.1).
--
-- Only the tables Phase 1b needs are created here. The overlay table is
-- deliberately one shape for every overlay layer: they are all
-- (classification, geometry) and nothing in the model needs them to differ.

create table if not exists reference.dataset_version (
  id            bigserial primary key,
  dataset       text not null,
  scope         text not null,
  vintage       text not null,
  source_url    text not null,
  retrieved_at  timestamptz not null,
  checksum      text not null,
  row_count     bigint not null default 0,
  review_by     date,
  superseded_by bigint references reference.dataset_version(id),
  unique (dataset, scope, vintage),
  constraint dataset_version_dataset_known check (
    dataset in ('ssurgo', 'parcel', 'fema-nfhl', 'nhd', 'nwi', 'cdl')
  )
);

create table if not exists reference.soil_map_unit (
  id                 bigserial primary key,
  dataset_version_id bigint not null references reference.dataset_version(id),
  mukey              text not null,
  map_unit_symbol    text not null,
  map_unit_name      text not null,
  slope_percent      numeric(5,2),
  drainage_class     text,
  nccpi              numeric(4,3),
  hydric             boolean,
  farmland_class     text,
  -- How the map unit's components were flattened to the single values above.
  -- The domain surfaces this in Derived.method; a figure whose aggregation rule
  -- is unknown is not reportable.
  aggregation_method text not null,
  geom               geometry(MultiPolygon, 4326) not null,
  -- Vocabularies must match src/domain/soil.ts exactly. An unmapped SSURGO
  -- value is a load failure, not a null (backend spec §8, step 3).
  constraint soil_drainage_class_known check (
    drainage_class is null or drainage_class in (
      'very poorly drained', 'poorly drained', 'somewhat poorly drained',
      'moderately well drained', 'well drained',
      'somewhat excessively drained', 'excessively drained'
    )
  ),
  constraint soil_farmland_class_known check (
    farmland_class is null or farmland_class in (
      'prime', 'prime-if-drained', 'prime-if-protected',
      'statewide-important', 'unique', 'not-prime'
    )
  ),
  constraint soil_nccpi_range check (nccpi is null or (nccpi >= 0 and nccpi <= 1)),
  constraint soil_aggregation_known check (
    aggregation_method in ('dominant-condition', 'weighted-average')
  )
);
create index if not exists soil_map_unit_geom_idx on reference.soil_map_unit using gist (geom);
create index if not exists soil_map_unit_version_idx on reference.soil_map_unit (dataset_version_id);

create table if not exists reference.parcel (
  id                 bigserial primary key,
  dataset_version_id bigint not null references reference.dataset_version(id),
  county_fips        text not null,
  parcel_pin         text not null,
  situs_address      text,
  acres_assessed     numeric(10,2),
  geom               geometry(MultiPolygon, 4326) not null
  -- No owner name. County layers usually carry one; we have no use for it and
  -- not holding it keeps this system out of a category of problem (spec §12).
);
create index if not exists parcel_geom_idx on reference.parcel using gist (geom);
create index if not exists parcel_pin_idx on reference.parcel (county_fips, parcel_pin);

create table if not exists reference.overlay (
  id                 bigserial primary key,
  dataset_version_id bigint not null references reference.dataset_version(id),
  layer              text not null,
  classification     text not null,
  geom               geometry(MultiPolygon, 4326) not null,
  constraint overlay_layer_known check (
    layer in ('floodplain', 'hydrography', 'wetland', 'cultivated')
  )
);
create index if not exists overlay_geom_idx on reference.overlay using gist (geom);
create index if not exists overlay_layer_idx on reference.overlay (layer, dataset_version_id);
