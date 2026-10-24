/**
 * The characterization adapter (backend spec §5.2–5.4).
 *
 * This is the whole seam between the spatial layer and the domain: it produces a
 * `LandUnit`, which is the only thing the domain knows how to consume. No
 * viability logic appears here, and no SQL appears in the domain.
 *
 * Geometry stays in PostGIS. This module builds queries and maps rows.
 */

import {
  landUnit,
  type FencingState,
  type LandUnit,
  type WaterAccess,
} from '../domain/land-unit.ts';
import type { SourceRef } from '../domain/provenance.ts';
import type {
  DrainageClass,
  FarmlandClass,
  SoilMapUnitObservation,
} from '../domain/soil.ts';
import {
  DEFAULT_GAP_METRES,
  DEFAULT_TILLAGE_SLOPE_LIMIT,
  GAP_BRACKET_METRES,
  METRIC_SRID,
  SLIVER_ACRE_THRESHOLD,
  SQUARE_METRES_PER_ACRE,
} from './constants.ts';
import { query, queryOne } from './db.ts';

export interface CharacterizationOptions {
  /** Which ingested dataset versions to read. Pinned into the result. */
  readonly datasetVersionIds: readonly number[];
  readonly gapMetres?: number;
  readonly tillageSlopeLimit?: number;
  readonly sliverAcreThreshold?: number;
  /** Provenance for the soil figures; normally built from `dataset_version`. */
  readonly soilSource?: SourceRef;
}

/** Parameters that produced the contiguity figure. Never optional in output. */
export interface ContiguityMethod {
  readonly gapMetres: number;
  readonly tillageSlopeLimit: number;
  readonly sliverAcreThreshold: number;
  readonly tillableSource: 'cultivated-mask' | 'land-unit-extent';
  readonly blockCount: number;
  readonly blockAcres: readonly number[];
  /** True when no block survived erosion — every block is narrower than 2×gap. */
  readonly annihilated: boolean;
}

export interface Characterization {
  readonly landUnit: LandUnit;
  readonly tillableAcres: number;
  readonly contiguityMethod: ContiguityMethod;
  /** Acres inside the boundary that no map unit accounted for, plus dropped slivers. */
  readonly unattributedAcres: number;
  readonly datasetVersionIds: readonly number[];
}

interface LandUnitRow {
  readonly id: string;
  readonly label: string;
  readonly water_access: string;
  readonly fencing: string;
  readonly acres: number;
  readonly contiguous_acres: number;
}

/** A row of the soil-attachment query. Exported so the mapping can be tested. */
export interface SoilRow {
  readonly map_unit_symbol: string;
  readonly map_unit_name: string;
  readonly slope_percent: number | null;
  readonly drainage_class: string | null;
  readonly nccpi: number | null;
  readonly hydric: boolean | null;
  readonly farmland_class: string | null;
  readonly aggregation_method: string;
  readonly acres: number;
}

interface ContiguityRow {
  readonly tillable_acres: number;
  readonly largest_block_acres: number;
  readonly block_count: number;
  readonly block_acres: number[];
  readonly annihilated: boolean;
}

const LAND_UNIT_SQL = `
  select lu.id::text, lu.label, lu.water_access, lu.fencing,
         reference.acres(lu.geom)::float8 as acres,
         parts.contiguous_acres::float8
  from working.land_unit lu
  cross join lateral (
    select max(reference.acres(p.geom)) as contiguous_acres
    from (select (st_dump(lu.geom)).geom as geom) p
  ) parts
  where lu.id = $1
`;

// The intersection predicate runs in storage SRID so it uses the GiST index;
// only the surviving pairs are transformed for the area computation.
const SOILS_SQL = `
  select s.map_unit_symbol, s.map_unit_name,
         s.slope_percent::float8, s.drainage_class,
         s.nccpi::float8, s.hydric, s.farmland_class, s.aggregation_method,
         (st_area(st_intersection(
            st_transform(s.geom, $3::int), st_transform(lu.geom, $3::int)
          )) / $4::float8)::float8 as acres
  from reference.soil_map_unit s
  join working.land_unit lu on lu.id = $1 and st_intersects(s.geom, lu.geom)
  where s.dataset_version_id = any($2::bigint[])
  order by acres desc
`;

const CONTIGUITY_SQL = `
  select tillable_acres::float8, largest_block_acres::float8,
         block_count, block_acres, annihilated
  from working.contiguity($1, $2::bigint[], $3::float8, $4::float8)
`;

const CULTIVATED_PRESENT_SQL = `
  select exists (
    select 1 from reference.overlay
    where layer = 'cultivated' and dataset_version_id = any($1::bigint[])
  ) as present
`;

export async function characterizeLandUnit(
  landUnitId: string,
  options: CharacterizationOptions,
): Promise<Characterization> {
  const gapMetres = options.gapMetres ?? DEFAULT_GAP_METRES;
  const tillageSlopeLimit = options.tillageSlopeLimit ?? DEFAULT_TILLAGE_SLOPE_LIMIT;
  const sliverAcreThreshold = options.sliverAcreThreshold ?? SLIVER_ACRE_THRESHOLD;
  const versions = [...options.datasetVersionIds];

  const [unit, soilRows, contiguity, cultivated] = await Promise.all([
    queryOne<LandUnitRow>(LAND_UNIT_SQL, [landUnitId]),
    query<SoilRow>(SOILS_SQL, [landUnitId, versions, METRIC_SRID, SQUARE_METRES_PER_ACRE]),
    queryOne<ContiguityRow>(CONTIGUITY_SQL, [
      landUnitId,
      versions,
      gapMetres,
      tillageSlopeLimit,
    ]),
    queryOne<{ present: boolean }>(CULTIVATED_PRESENT_SQL, [versions]),
  ]);

  const kept = soilRows.filter((row) => row.acres >= sliverAcreThreshold);
  const soils = kept.map((row) => toSoilObservation(row, unit.label));
  const attributedAcres = soils.reduce((total, soil) => total + soil.acres, 0);

  const soilSource: SourceRef = options.soilSource ?? (await defaultSoilSource(versions));

  const contiguityMethod: ContiguityMethod = {
    gapMetres,
    tillageSlopeLimit,
    sliverAcreThreshold,
    tillableSource: cultivated.present ? 'cultivated-mask' : 'land-unit-extent',
    blockCount: contiguity.block_count,
    blockAcres: contiguity.block_acres,
    annihilated: contiguity.annihilated,
  };

  return {
    landUnit: landUnit({
      id: unit.id,
      label: unit.label,
      acres: unit.acres,
      contiguousAcres: { acres: unit.contiguous_acres, basis: 'observed' },
      contiguousTillableAcres: {
        acres: contiguity.largest_block_acres,
        basis: 'observed',
        note: describeContiguity(contiguityMethod),
      },
      waterAccess: unit.water_access as WaterAccess,
      fencing: unit.fencing as FencingState,
      soils,
      soilSource,
    }),
    tillableAcres: contiguity.tillable_acres,
    contiguityMethod,
    unattributedAcres: Math.max(0, unit.acres - attributedAcres),
    datasetVersionIds: versions,
  };
}

export interface ContiguityBracket {
  readonly permissive: { readonly gapMetres: number; readonly acres: number };
  readonly strict: { readonly gapMetres: number; readonly acres: number };
  /**
   * True when the two ends of the plausible gap range disagree by enough to
   * matter. The parcel has a narrow connection somewhere, and whether it counts
   * is a question for someone standing on the ground — not for a parameter.
   */
  readonly crossingDependent: boolean;
  /** Fractional difference between the two readings. */
  readonly spread: number;
}

/**
 * Computes contiguity at both ends of the plausible gap range.
 *
 * Phase 1b's finding is that this disagreement is not hypothetical and can move
 * the fragmentation threshold by a whole share. Where it disagrees, the
 * permissive figure is the one to carry forward: it is the upper bound, and the
 * domain's soundness property depends on contiguity being an upper bound — an
 * enterprise that fails even on the optimistic reading genuinely fails.
 */
export async function bracketContiguity(
  landUnitId: string,
  options: CharacterizationOptions,
  bracket: readonly [number, number] = GAP_BRACKET_METRES,
  materialThreshold = 0.05,
): Promise<ContiguityBracket> {
  const [permissiveGap, strictGap] = bracket;
  const versions = [...options.datasetVersionIds];
  const slope = options.tillageSlopeLimit ?? DEFAULT_TILLAGE_SLOPE_LIMIT;

  const [permissive, strict] = await Promise.all(
    [permissiveGap, strictGap].map((gap) =>
      queryOne<ContiguityRow>(CONTIGUITY_SQL, [landUnitId, versions, gap, slope]),
    ),
  );

  const high = permissive?.largest_block_acres ?? 0;
  const low = strict?.largest_block_acres ?? 0;
  const spread = high > 0 ? (high - low) / high : 0;

  return {
    permissive: { gapMetres: permissiveGap, acres: high },
    strict: { gapMetres: strictGap, acres: low },
    crossingDependent: spread > materialThreshold,
    spread,
  };
}

function describeContiguity(method: ContiguityMethod): string {
  const base = `Largest contiguous tillable block, from the ${method.tillableSource} at a ${method.gapMetres} m erosion gap and a ${method.tillageSlopeLimit}% tillage slope limit`;
  if (method.annihilated) {
    return `${base}. No block survived erosion: nothing here is wider than ${
      2 * method.gapMetres
    } m, so the figure is not usable.`;
  }
  return method.blockCount > 1
    ? `${base}. ${method.blockCount} separate blocks; the gap parameter decides whether narrow connections count, so confirm them on the ground.`
    : `${base}.`;
}

/**
 * A null drainage or farmland class cannot be turned into a domain observation.
 * Throwing names the map unit; defaulting would put an invented soil into a
 * brief, which is the failure mode the whole provenance apparatus exists to
 * prevent.
 */
export function toSoilObservation(row: SoilRow, unitLabel: string): SoilMapUnitObservation {
  const missing = [
    row.drainage_class === null ? 'drainage class' : null,
    row.farmland_class === null ? 'farmland class' : null,
    row.slope_percent === null ? 'slope' : null,
    row.hydric === null ? 'hydric flag' : null,
  ].filter((field): field is string => field !== null);

  if (missing.length > 0) {
    throw new Error(
      `Map unit ${row.map_unit_symbol} on "${unitLabel}" is missing ${missing.join(', ')}. ` +
        'Fix the ETL normalization rather than defaulting the value.',
    );
  }

  return {
    mapUnitSymbol: row.map_unit_symbol,
    mapUnitName: row.map_unit_name,
    acres: row.acres,
    slopePercent: row.slope_percent as number,
    drainageClass: row.drainage_class as DrainageClass,
    nccpi: row.nccpi,
    hydric: row.hydric as boolean,
    farmlandClass: row.farmland_class as FarmlandClass,
  };
}

async function defaultSoilSource(versions: readonly number[]): Promise<SourceRef> {
  const rows = await query<{
    scope: string;
    vintage: string;
    retrieved_at: Date;
    source_url: string;
  }>(
    `select scope, vintage, retrieved_at, source_url
     from reference.dataset_version
     where dataset = 'ssurgo' and id = any($1::bigint[])
     order by id limit 1`,
    [[...versions]],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('No SSURGO dataset version among the ids supplied.');
  }
  return {
    dataset: `USDA-NRCS SSURGO — ${row.scope}`,
    vintage: row.vintage,
    retrieved: row.retrieved_at.toISOString().slice(0, 10),
    reference: row.source_url,
  };
}
