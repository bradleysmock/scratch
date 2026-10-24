-- 003: working schema — what a session produces (backend spec §4.2).
--
-- Phase 1b needs holdings, land units, and characterizations. Sessions,
-- scenarios, runs, and overrides arrive in Phase 1c and 2a.

create table if not exists working.holding (
  id         uuid primary key,
  label      text not null,
  created_at timestamptz not null default now()
);

create table if not exists working.land_unit (
  id           uuid primary key,
  holding_id   uuid not null references working.holding(id) on delete cascade,
  label        text not null,
  origin       text not null,
  parent_id    uuid references working.land_unit(id),
  geom         geometry(MultiPolygon, 4326) not null,
  water_access text not null default 'unknown',
  fencing      text not null default 'unknown',
  created_at   timestamptz not null default now(),
  constraint land_unit_origin_known check (
    origin in ('parcel-selection', 'drawn', 'subdivision-share')
  ),
  constraint land_unit_water_known check (
    water_access in ('none', 'seasonal', 'year-round', 'unknown')
  ),
  constraint land_unit_fencing_known check (
    fencing in ('none', 'partial', 'perimeter', 'unknown')
  )
);
create index if not exists land_unit_geom_idx on working.land_unit using gist (geom);

-- Which parcels a land unit was assembled from, so a brief can be traced back
-- to county records.
create table if not exists working.land_unit_parcel (
  land_unit_id uuid not null references working.land_unit(id) on delete cascade,
  parcel_id    bigint not null references reference.parcel(id),
  primary key (land_unit_id, parcel_id)
);

-- Immutable. A re-characterization is a new row, never an update: an old run
-- must keep reading exactly the figures it was built on (backend spec §7).
create table if not exists working.characterization (
  id                        uuid primary key,
  land_unit_id              uuid not null references working.land_unit(id) on delete cascade,
  acres                     numeric(12,3) not null,
  contiguous_acres          numeric(12,3) not null,
  contiguous_tillable_acres numeric(12,3),
  tillable_acres            numeric(12,3),
  -- Parameters that produced the contiguity figures: erosion gap, tillage slope
  -- limit, tillable source, and whether erosion annihilated every block. The
  -- gap changes the answer (see docs/phase-1b-findings.md), so a contiguity
  -- figure without its parameters is not reportable.
  contiguity_method         jsonb not null,
  soils                     jsonb not null,
  overlays                  jsonb not null,
  unattributed_acres        numeric(12,3) not null default 0,
  dataset_version_ids       bigint[] not null,
  computed_at               timestamptz not null default now()
);
create index if not exists characterization_land_unit_idx
  on working.characterization (land_unit_id, computed_at desc);
