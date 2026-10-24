/**
 * Constants shared with the database (backend spec §5.1).
 *
 * `001_schemas.sql` defines the same acre and the same metric SRID as SQL
 * functions. A test asserts the two agree: an acreage figure that differed
 * between SQL and the domain would be invisible, and wrong in both directions
 * at once.
 */

/** One acre in square metres, by the international definition. */
export const SQUARE_METRES_PER_ACRE = 4046.8564224;

/** Storage SRID. Everything is stored in WGS 84 lon/lat. */
export const STORAGE_SRID = 4326;

/**
 * Metric SRID: NAD83 / Conus Albers, equal-area. Every area, length, and buffer
 * is computed here because it is what NRCS uses for national soils work, so a
 * prime-farmland percentage is computed the way ACEP-ALE ranking expects.
 */
export const METRIC_SRID = 5070;

/**
 * Default erosion gap for the contiguity computation, in metres. A connection
 * narrower than twice this is treated as not joining two blocks.
 *
 * This is not a settled number. Phase 1b found that the fragmentation threshold
 * can move by a whole share across a plausible range of it
 * (docs/phase-1b-findings.md), which is why every characterization records the
 * gap it used and why `bracketContiguity` exists.
 */
export const DEFAULT_GAP_METRES = 5;

/** Permissive and strict ends of the plausible range, for bracketing. */
export const GAP_BRACKET_METRES: readonly [number, number] = [2, 7.5];

/**
 * General tillage slope limit, percent. Distinct from the per-enterprise slope
 * ceilings in the threshold catalog: this one asks whether ground is cropland at
 * all, not whether a given enterprise tolerates it.
 */
export const DEFAULT_TILLAGE_SLOPE_LIMIT = 12;

/** Map-unit intersections below this are dropped and reported as unattributed. */
export const SLIVER_ACRE_THRESHOLD = 0.1;
