-- 004: the contiguity computation (backend spec §5.4).
--
-- This is the linchpin of the product. Every acreage criterion in the viability
-- model reads `contiguous_tillable_acres`, and the fragmentation threshold —
-- the number the whole tool exists to produce — is that figure divided by the
-- number of heirs.
--
-- Tillable extent = land unit
--                 ∩ cultivated mask
--                 − wetland − open water
--                 − map units above the general tillage slope limit
--
-- Largest contiguous block = erode by `gap`, split into connected components,
-- dilate each back by `gap`, clip to the un-eroded tillable extent, take the
-- largest. The erosion is what stops two fields joined by a narrow headland
-- from counting as one block: a connection survives if and only if it is wider
-- than 2 × gap.
--
-- Dilating and clipping (rather than measuring the eroded component) recovers
-- the true block area instead of a shrunken one. A severed headland cannot
-- re-bridge two blocks this way, because each dilated component reaches back
-- only `gap` metres and the headland that failed erosion is narrower than 2×gap.
--
-- `gap` is a parameter, not a constant, and it changes the answer. Callers must
-- record it. See docs/phase-1b-findings.md.

create or replace function working.contiguity(
  p_land_unit_id        uuid,
  p_dataset_version_ids bigint[],
  p_gap_metres          double precision default 5.0,
  p_tillage_slope_limit double precision default 12.0
)
returns table (
  tillable_acres      double precision,
  largest_block_acres double precision,
  block_count         integer,
  block_acres         double precision[],
  annihilated         boolean
)
language sql stable
as $$
  with lu as (
    select st_transform(geom, reference.metric_srid()) as g
    from working.land_unit
    where id = p_land_unit_id
  ),
  masks as (
    select
      (select st_union(st_transform(o.geom, reference.metric_srid()))
         from reference.overlay o
        where o.layer = 'cultivated'
          and o.dataset_version_id = any(p_dataset_version_ids)) as cultivated,
      (select st_union(st_transform(o.geom, reference.metric_srid()))
         from reference.overlay o
        where o.layer in ('wetland', 'hydrography')
          and o.dataset_version_id = any(p_dataset_version_ids)) as wet,
      (select st_union(st_transform(s.geom, reference.metric_srid()))
         from reference.soil_map_unit s
        where s.slope_percent > p_tillage_slope_limit
          and s.dataset_version_id = any(p_dataset_version_ids)) as steep
  ),
  tillable as (
    -- A missing cultivated mask means "no mask", not "nothing is cultivated":
    -- the land unit stands in for it and the caller is told the source.
    select st_makevalid(
             st_difference(
               st_intersection(lu.g, coalesce(masks.cultivated, lu.g)),
               st_union(
                 coalesce(masks.wet, 'POLYGON EMPTY'::geometry),
                 coalesce(masks.steep, 'POLYGON EMPTY'::geometry)
               )
             )
           ) as g
    from lu, masks
  ),
  components as (
    select (st_dump(st_buffer(t.g, -p_gap_metres))).geom as part
    from tillable t
    where not st_isempty(st_buffer(t.g, -p_gap_metres))
  ),
  blocks as (
    select st_area(
             st_intersection(
               st_buffer(c.part, p_gap_metres),
               (select g from tillable)
             )
           ) / reference.square_metres_per_acre() as acres
    from components c
  )
  select
    (select st_area(g) from tillable) / reference.square_metres_per_acre(),
    coalesce(max(b.acres), 0),
    count(*)::integer,
    coalesce(array_agg(b.acres order by b.acres desc), array[]::double precision[]),
    count(*) = 0
  from blocks b;
$$;

comment on function working.contiguity(uuid, bigint[], double precision, double precision) is
  'Largest contiguous tillable block. The gap parameter changes the answer; record it with the result.';
