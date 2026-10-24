# Phase 1b — contiguity prototype and calibration

**Date:** October 24, 2026
**Phase:** 1b of the backend spec — "Land unit from parcels, soil attachment, contiguity prototype and calibration (§5.4)"
**Status:** prototype built and behaving as specified; **calibration against real ground not done, and cannot be done from the build environment**

---

## 1. The headline

**The erosion gap parameter moves the row-crop fragmentation threshold from three shares to two.**

That is the number the product exists to produce, and it changed by a whole heir on a
parameter change of 0.2 metres. The same geometry, the same soils, the same thresholds —
different advice to a family deciding how many children get farmable land.

```
gap (m)  largest block   blocks  row-crop  hay  timber
-------------------------------------------------------
0.0      138.38 ac       1       3         8    8
1.0      138.38 ac       1       3         8    8
2.0      138.38 ac       1       3         8    8
3.0      138.37 ac       1       3         8    8
3.5      138.37 ac       1       3         8    8
4.0       86.42 ac       2       2         8    8
5.0       86.38 ac       2       2         8    8
7.5       86.37 ac       2       2         8    8
10.0      86.36 ac       2       2         8    8
15.0      86.33 ac       2       2         8    8
```

(Columns are the largest number of equal shares at which the enterprise is still supported
outright. Reproduce with `npm run calibrate`.)

The headline acreage swings 37.6% across the plausible range of the parameter. The
fragmentation threshold for row crop swings with it. Hay and timber do not move, for a
reason worth stating precisely (§4).

---

## 2. What was built

| Piece | Where |
| --- | --- |
| `reference` / `working` schemas, dataset-version pinning | `db/migrations/001`–`003` |
| The contiguity computation as a versioned SQL function | `db/migrations/004_contiguity.sql` |
| Constructed fixture holding | `db/fixtures/constructed-holding.sql` |
| Characterization adapter: PostGIS → domain `LandUnit` | `src/spatial/characterize.ts` |
| Calibration harness | `src/calibration/gap-sweep.ts` |
| Tests | `src/spatial/characterize.test.ts` (10 database-gated, 4 pure) |

The seam held. The adapter produces a `LandUnit`; the domain consumed it unchanged; no
viability logic migrated into SQL and no SQL appeared in the domain. The whole suite is 85
tests, and the 10 that need PostGIS skip cleanly on a machine without it — so the domain
core stays independently testable, as §1 of the backend spec requires.

The language decision in backend spec §2 survived contact with the work: every operation —
union, intersection, difference, buffer, dump, area — is a PostGIS built-in. Nothing wanted
an in-process geometry library.

---

## 3. What was NOT established

**No real soils or parcel data were used.** The environment's network policy denied
`SDMDataAccess.sc.egov.usda.gov`, so USDA Soil Data Access was unreachable, and county
parcel data remains blocked on licensing in any case (narrowed spec open question 3).

Everything in `db/fixtures/constructed-holding.sql` is constructed, labelled as such in the
file, and corresponds to no real property or published survey. The acreages above are
arithmetic consequences of a geometry I designed, not measurements of anything.

**So the calibration half of Phase 1b is still open.** What this work establishes is a
property of the algorithm and of a class of geometry. What it cannot establish is the right
gap value for a real farm, which needs real soils, a real parcel boundary, and someone who
has walked the ground.

To finish 1b: add `SDMDataAccess.sc.egov.usda.gov` to the environment's allowed domains
(Network access in the environment settings, Allowed domains, leaving the package-manager
box ticked — https://code.claude.com/docs/en/cloud-environments#network-access), get one
real parcel boundary, and re-run the sweep against Maple Hill.

---

## 4. Why the parameter matters, and exactly when

The fixture is laid out as a field system that is extremely ordinary in southern Michigan:
two tillable blocks separated by a wet swale, joined by one 8-metre crossing where equipment
goes over.

The erode-dump-dilate computation severs a connection exactly when the connection is
narrower than twice the gap. An 8 m crossing therefore survives a 3 m gap and fails a 4 m
gap, and the largest contiguous block drops from 138 acres to 86 — the north block falls
away entirely.

**The sensitivity is not uniform across enterprises.** It bites exactly when an enterprise's
acreage floor falls between the two readings divided by some share count:

- Row crop, 40-acre floor: 138/3 = 46 acres clears it, 86/3 = 29 acres does not. The
  parameter decides.
- Hay, 10-acre floor: 86/8 = 11 acres clears it either way. The parameter is irrelevant.
- Timber, 20-acre floor on the whole tract: unaffected, it does not read tillable acreage.

This is a usable rule rather than a vague warning. The product can tell, per enterprise and
per share count, whether its own answer depends on the parameter — and flag only those.

**The Cropland Data Layer cannot settle it.** The CDL is a 30-metre raster. An 8-metre
crossing is a third of one pixel. Even with real data in hand, the cultivated mask is
physically incapable of saying whether that crossing exists. This sharpens backend spec open
question 2: the CDL is adequate for the bulk of a field's extent and useless for its
connections, which are the part that decides the headline number.

---

## 5. Recommendation

**Compute contiguity at both ends of the plausible range, carry the permissive figure, and
flag the parcel when the two disagree.** Implemented as `bracketContiguity`.

Carrying the permissive (larger) figure is not optimism, it is what keeps the domain honest.
The soundness property the product rests on is that contiguity is an *upper bound*, so an
enterprise that fails even on the generous reading genuinely fails. Carrying the strict
figure instead would make "lost" claims unsound in the other direction — it would report
losses that a 3-metre gap would not have found.

So, concretely:

1. Characterize with the permissive gap. Loss claims stay sound.
2. Where the bracket disagrees materially (default: 5% of the larger figure), mark the land
   unit crossing-dependent.
3. In the brief, for every enterprise whose threshold differs between the two readings, say
   so in the enterprise's own row — not in a footnote. "Row crop survives a three-way split
   if the crossing at the swale counts as a connection, and a two-way split if it does not.
   Go and look at it."
4. Let the advisor override the tillable extent by drawing the fields, which is the only
   thing that actually settles it. The override is already recorded in
   `contiguity_method.tillableSource`.

That last point is the real answer: this is a question for a person on the ground, and the
tool's job is to notice that it needs asking and to say which decision turns on it.

---

## 6. A second finding, from a bug

The first version of the fixture built each rectangle in Albers and transformed each one to
WGS 84 independently. A line of constant northing in Albers is not a line of constant
latitude, so edges that should have coincided came out fractionally apart, and a
sub-millimetre wedge of wetland severed the headland. The computation was correct and the
fixture was lying to it.

**This is a real ETL hazard, not a test artifact.** Narrow features — field crossings,
grassed waterways, drain corridors, parcel strips — are exactly where a transform's vertex
error decides topology. Backend spec §8 should be explicit: transform once on load, then
node the geometry; never rely on edges coinciding across independent transforms of
neighbouring features.

Worth adding to the ETL assertions in §8 step 5: after load, assert that adjacent features
which should share a boundary actually do.

---

## 7. What this changes in the spec

- **§5.4** — the gap is not a parameter to "calibrate" to a single value. Bracket it. The
  single-value framing was wrong.
- **§5.6** — the cultivated mask is adequate for field extent and unusable for connections.
  Advisor-drawn tillable extent moves from a nice-to-have to the thing that resolves the
  headline number on any crossing-dependent parcel.
- **§8** — add the transform-once-then-node rule and the shared-boundary assertion.
- **Open question 3** — answered in part: yes, it moves the answer, by a whole share, on
  ordinary geometry. What remains open is how often real Washtenaw parcels are
  crossing-dependent. That is measurable once one real parcel is in hand, and it decides
  whether this is an edge case or the normal case.

---

## 8. Running it

PostgreSQL 16 with PostGIS 3.4 (the versions the spec names) installs from Ubuntu's own
repositories:

```bash
sudo apt-get install -y postgresql-16 postgresql-16-postgis-3 postgresql-16-postgis-3-scripts
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "create role psc login password 'psc';" -c "create database psc owner psc;"
sudo -u postgres psql -d psc -c "create extension postgis;"

export PSC_DATABASE_URL="postgresql://psc:psc@127.0.0.1:5432/psc"
npm run db:migrate
npm run db:fixtures
npm run calibrate
npm test          # 85 tests; the 10 spatial ones skip without PSC_DATABASE_URL
```
