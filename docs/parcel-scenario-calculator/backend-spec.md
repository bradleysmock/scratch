# Parcel Scenario Calculator — Backend Specification

**Version:** 0.1 (draft)
**Date:** September 7, 2026
**Owner:** Bradley — Maple Hill Farm
**Elaborates:** §7 of *Parcel Scenario Calculator — Narrowed Specification* v0.1
**Assumes:** the domain core on this branch (`src/domain`), which is built and tested

---

## 0. What this document decides

The narrowed spec settled the architecture in a paragraph: Postgres + PostGIS, batch ETL,
pure domain layer, no auth, no LLM. That paragraph is right and this document does not
revisit it. What it does is answer the questions that paragraph leaves open and that block
Phase 1:

- What exactly gets ingested, from where, and how a vintage is pinned.
- What the spatial layer computes, precisely — including the one operation the whole
  product rests on and that nothing currently produces: **largest contiguous tillable
  acreage**.
- What the API looks like, given that a "session" has no user attached to it.
- How a brief stays reproducible for twenty years when the data under it changes annually.
- Where the offline-tolerance requirement collides with server rendering, and what is
  actually promised.

Out of scope here: frontend structure, PDF visual design, the content of programme rules
(PA 116, ACEP-ALE, PDR), and the Phase 0 kill-or-confirm conversations, which still have
not happened and still gate all of this.

---

## 1. What already exists

The domain core is built: `provenance`, `soil`, `land-unit`, `enterprise`, `thresholds`,
`viability`, `subdivision`, `scenario`, `fragmentation`, `brief`. 71 tests, no database, no
network, no filesystem. It is the part the narrowed spec says must be unit-testable alone,
and it is finished enough that the backend's job is now clear:

**The backend's entire responsibility is to produce `LandUnit` values, hand them to the
domain with a threshold catalog, and durably store what comes back.**

That is a smaller job than it sounds, and stating it this way keeps it small. Every
temptation to compute viability in SQL, or to let a repository return a half-evaluated
scenario, is a violation of it.

```
HTTP  ──>  application services  ──>  domain (pure, already built)
                  │
                  └──>  ports  ──>  adapters: PostGIS repositories
                                              PDF renderer
                                              object store
                                              clock, id generator
```

**Dependency rule:** `domain` imports nothing outside itself. Adapters depend on ports;
ports are defined by the application layer in domain vocabulary. A repository returns a
`LandUnit`, never a row.

---

## 2. Language: TypeScript. Here is the argument the spec asked for.

§7 says to decide by prototyping the subdivision geometry operation first. The operations
in §5 below — union, dump, buffer, area, intersection, connected components — are all
PostGIS built-ins. Nothing in the v1 workload requires a geometry library in the
application process: the app layer builds SQL, PostGIS does the geometry, and the results
arrive as scalars the domain already consumes.

**Decision: TypeScript, with all geometry inside PostGIS.** The domain core is already
TypeScript, one language across ETL, API, and domain keeps a one-person project moving,
and the GeoTools argument in §7 buys nothing we currently need.

**What would flip it to Java:** an operation we cannot express in PostGIS and must run
in-process. The live candidate is automated equal-area partitioning (§5.5) — if that
becomes a v1 requirement rather than a research task, revisit. Prototype the contiguity
operation (§5.4) before committing either way; it is the one that could surprise us.

---

## 3. Runtime shape

One deployable, one database, one batch runner. Deliberately boring, per §7.

| Component | What it is | Why |
| --- | --- | --- |
| `api` | Single Node process: HTTP, server-rendered pages, JSON API | Low write volume, low concurrency. A modular monolith is correct here and will stay correct. |
| `worker` | Same image, different entrypoint; runs characterization, scenario runs, PDF rendering | These take seconds, not milliseconds. They must not block a request in a meeting. |
| `etl` | Same image, invoked on a schedule or by hand | Annual-to-quarterly cadence. Not a service. |
| `postgres` | PostgreSQL 16+ with PostGIS 3.4+ | Non-negotiable per §7. |
| `objects` | Filesystem or S3-compatible bucket | Rendered PDFs and map images. Not in the database. |

Job queue: a `job` table with `SELECT … FOR UPDATE SKIP LOCKED`. No Redis, no broker.
At this volume a database-backed queue is simpler to operate and easier to reason about
after a crash, and it keeps job state in the same backup as everything else.

---

## 4. Data

Two schemas, with a hard line between them.

**`reference`** — everything the ETL owns. Read-only at request time. Never written by a
web request. Versioned by dataset, not by row.

**`working`** — everything a session produces. Written by the app. Never written by the ETL.

### 4.1 Reference schema

```sql
create schema reference;

-- One row per (dataset, vintage) load. Everything derived pins these ids.
create table reference.dataset_version (
  id              bigserial primary key,
  dataset         text not null,              -- 'ssurgo' | 'parcel' | 'fema-nfhl' | 'nhd' | 'nwi' | 'cdl'
  scope           text not null,              -- survey area or county FIPS
  vintage         text not null,              -- as published: '2025', '2026-03-01'
  source_url      text not null,
  retrieved_at    timestamptz not null,
  checksum        text not null,              -- of the downloaded archive
  row_count       bigint not null,
  review_by       date,                       -- staleness horizon (§5.5)
  superseded_by   bigint references reference.dataset_version(id),
  unique (dataset, scope, vintage)
);

-- SSURGO map unit polygons, one row per polygon, attributes denormalized at load.
create table reference.soil_map_unit (
  id                 bigserial primary key,
  dataset_version_id bigint not null references reference.dataset_version(id),
  mukey              text not null,
  map_unit_symbol    text not null,
  map_unit_name      text not null,
  slope_percent      numeric(5,2),            -- muaggatt.slopegradwta
  drainage_class     text,                    -- muaggatt.drclassdcd, normalized to our vocabulary
  nccpi              numeric(4,3),            -- gSSURGO Valu1
  hydric             boolean,                 -- derived from muaggatt.hydclprs, threshold recorded
  farmland_class     text,                    -- mapunit.farmlndcl, normalized
  aggregation_method text not null,           -- 'dominant-condition' | 'weighted-average'
  geom               geometry(MultiPolygon, 4326) not null
);
create index on reference.soil_map_unit using gist (geom);
create index on reference.soil_map_unit (dataset_version_id);

create table reference.parcel (
  id                 bigserial primary key,
  dataset_version_id bigint not null references reference.dataset_version(id),
  county_fips        text not null,
  parcel_pin         text not null,           -- county parcel identification number
  situs_address      text,
  acres_assessed     numeric(10,2),           -- as published; ours is computed separately
  geom               geometry(MultiPolygon, 4326) not null
);
create index on reference.parcel using gist (geom);
create index on reference.parcel (county_fips, parcel_pin);

-- Overlays share a shape: id, dataset_version_id, classification, geom.
create table reference.overlay (
  id                 bigserial primary key,
  dataset_version_id bigint not null references reference.dataset_version(id),
  layer              text not null,           -- 'floodplain' | 'hydrography' | 'wetland' | 'cultivated'
  classification     text not null,           -- e.g. FEMA zone, NWI code, CDL cultivated flag
  geom               geometry(MultiPolygon, 4326) not null
);
create index on reference.overlay using gist (geom);
```

**Owner names are not ingested.** County parcel layers usually carry them; we do not need
them, and not having them keeps this system out of a category of problem it has no reason
to be in. Situs address is kept because intake needs address search (§5.1 of the spec).

### 4.2 Working schema

```sql
create schema working;

create table working.session (
  id           uuid primary key,
  token_hash   text not null unique,          -- the token itself is never stored
  created_at   timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at   timestamptz not null,
  label        text                           -- advisor's own note, e.g. 'Tues 2pm, Dohner'
);

create table working.holding (
  id         uuid primary key,
  session_id uuid not null references working.session(id) on delete cascade,
  label      text not null,
  created_at timestamptz not null
);

create table working.land_unit (
  id            uuid primary key,
  holding_id    uuid not null references working.holding(id) on delete cascade,
  label         text not null,
  origin        text not null,                -- 'parcel-selection' | 'drawn' | 'subdivision-share'
  parent_id     uuid references working.land_unit(id),
  geom          geometry(MultiPolygon, 4326) not null,
  water_access  text not null default 'unknown',
  fencing       text not null default 'unknown',
  created_at    timestamptz not null
);
create index on working.land_unit using gist (geom);

-- The materialized result of §5. Immutable; a new characterization is a new row.
create table working.characterization (
  id                        uuid primary key,
  land_unit_id              uuid not null references working.land_unit(id) on delete cascade,
  acres                     numeric(12,3) not null,
  contiguous_acres          numeric(12,3) not null,
  contiguous_tillable_acres numeric(12,3),               -- null means unknown, not zero
  contiguity_method         jsonb not null,              -- parameters: buffer, tillable source
  soils                     jsonb not null,              -- SoilMapUnitObservation[]
  overlays                  jsonb not null,
  dataset_version_ids       bigint[] not null,
  computed_at               timestamptz not null
);

create table working.threshold_catalog (
  version       text primary key,
  effective_from date not null,
  publisher     text not null,
  document      jsonb not null                -- the file, validated by parseThresholdCatalog
);

create table working.threshold_override (
  id           uuid primary key,
  holding_id   uuid not null references working.holding(id) on delete cascade,
  enterprise   text not null,
  field        text not null,
  value        jsonb not null,
  previous     jsonb not null,
  by_name      text not null,
  reason       text not null,
  at           timestamptz not null
);

create table working.scenario (
  id           uuid primary key,
  holding_id   uuid not null references working.holding(id) on delete cascade,
  kind         text not null,                 -- 'status-quo' | 'subdivision'
  label        text not null,
  plan         jsonb,                         -- SplitPlan for subdivision scenarios
  created_at   timestamptz not null
);

-- A run is the twenty-year artifact. Nothing in it may change after it is written.
create table working.run (
  id                  uuid primary key,
  holding_id          uuid not null references working.holding(id) on delete cascade,
  scenario_ids        uuid[] not null,
  catalog_version     text not null references working.threshold_catalog(version),
  override_ids        uuid[] not null,
  characterization_ids uuid[] not null,
  dataset_version_ids bigint[] not null,
  code_version        text not null,          -- git sha of the deployed image
  brief               jsonb not null,         -- BriefExport, verbatim
  brief_hash          text not null,          -- sha256 of the canonical JSON
  pdf_object_key      text,
  generated_at        timestamptz not null
);
```

**Everything derived is materialized and pinned.** A run stores the brief it produced, the
dataset versions underneath it, the catalog version, the overrides, and the code version.
Nothing is recomputed on read. This is what makes §6's "longevity" and "audit trail of what
the tool said and when" true rather than aspirational, and it is cheap: briefs are small and
rare.

---

## 5. The spatial layer

This is the part with real content. Everything here runs in PostGIS and produces the
scalars the domain already consumes.

### 5.1 Coordinate systems

Store everything in EPSG:4326. Compute every area, length, and buffer in an equal-area
projection — **EPSG:5070 (NAD83 / Conus Albers)**, which is what NRCS uses for national
soils work, so our prime-farmland percentages are computed the same way the ranking
criteria expect. Michigan State Plane South is the alternative if a county's parcel layer
arrives in it; verify its EPSG code against the delivered data rather than assuming one.

One acre is exactly 4046.8564224 m². Define it once, in SQL and in TypeScript, and test
that the two agree.

### 5.2 Land unit geometry

From selected parcels: `ST_UnaryUnion(ST_Collect(parcel.geom))`, then validate with
`ST_IsValid` / `ST_MakeValid`. From a drawn polygon: validate and snap to a grid to keep
vertex counts sane.

Record which parcels contributed, so a land unit can be traced back to county records in
the brief.

### 5.3 Soil attachment

```sql
select
  smu.map_unit_symbol,
  smu.map_unit_name,
  st_area(st_intersection(smu.geom::geography, lu.geom::geography)) / 4046.8564224 as acres,
  smu.slope_percent, smu.drainage_class, smu.nccpi, smu.hydric, smu.farmland_class
from reference.soil_map_unit smu
join working.land_unit lu on st_intersects(smu.geom, lu.geom)
where lu.id = $1 and smu.dataset_version_id = $2
```

(In practice, project to 5070 rather than casting to geography; the cast is shown for
brevity.) Slivers below a threshold — 0.1 acre is a reasonable starting point — are dropped
and their acreage reported as an unattributed remainder rather than silently redistributed.

**A decision with consequences: the map unit is our atom.** SSURGO map units are composites
of components with percentages, and we flatten each to a single drainage class, slope, and
NCCPI. The flattening rule (dominant condition vs weighted average) differs by attribute and
must be stored in `aggregation_method` and surfaced in the `Derived.method` string the
domain already carries. Evaluating viability component-by-component would be more faithful
and is a *domain* change, not an ETL change — do not let it arrive by accident through the
ETL.

Field names to verify against the vintage actually downloaded: `mapunit.farmlndcl`,
`muaggatt.drclassdcd`, `muaggatt.slopegradwta`, `muaggatt.hydclprs`, and the NCCPI column in
the gSSURGO Valu1 table. Normalize each to the vocabularies in `src/domain/soil.ts`
(`DRAINAGE_CLASSES`, `FARMLAND_CLASSES`); an unmapped value is a load failure, not a null.

### 5.4 Contiguous tillable acreage — prototype this first

Every acreage criterion in the viability model reads this number, and nothing currently
produces it. It is the highest-risk computation in the system.

**Tillable extent** = land unit geometry, minus water and wetland (NHD, NWI), minus
non-cultivated cover (NASS Cropland Data Layer, 30 m raster, vectorized at load), minus
map units above a general tillage slope limit. The CDL is coarse for a 40-acre field edge,
so the advisor must be able to override the result by drawing the fields; the override is
recorded as `contiguity_method.source = 'advisor-drawn'`.

**Largest contiguous block:**

```sql
with tillable as (select st_union(geom) as g from … ),
     eroded   as (select st_buffer(g, -$gap) as g from tillable),
     parts    as (select (st_dump(g)).geom as g from eroded)
select max(st_area(st_buffer(g, $gap))) / 4046.8564224 from parts;
```

The erode-then-dilate step is what stops two fields joined by a three-metre headland from
counting as one block. `$gap` is a parameter, not a constant: it changes the answer, it must
be recorded in `contiguity_method`, and **it must be calibrated against ground the owner
knows** — Maple Hill and the family farm, per Phase 1. If a plausible range of `$gap`
produces materially different fragmentation thresholds, that is a finding about the model's
robustness and belongs in the brief, not in a config file.

### 5.5 Subdivision geometry

For v1 the backend does **not** invent share boundaries.

- **Advisor-drawn shares** and **field-boundary allocation** produce real geometry, are
  validated (shares within the parent, no overlaps, remainder reported), and feed the
  domain's `explicit` plan with observed — not estimated — acreages.
- **Equal-acreage** stays geometry-free. The domain already models it with upper bounds and
  says so in the brief. This is the honest answer to "what does a four-way split do?" when
  nobody has drawn the lines yet, and it is available before any digitizing work.

Automated equal-area partitioning (sweep-line binary search on a rotated axis, or a
weighted Voronoi variant) is a research task. It is the one candidate that could justify
moving geometry in-process, and it is not a v1 commitment.

### 5.6 Overlays

Floodplain, hydrography, and wetland acreages are computed the same way as soils
(intersection, area, attribute) and stored in `characterization.overlays`. They inform the
brief and the tillable mask; they do not currently enter the viability model. Wiring them
into viability would be a domain change with its own tests.

---

## 6. API

REST, `/v1`, JSON, `application/problem+json` for errors (RFC 9457). Server-rendered HTML
for the advisor's screens shares the same application services; the JSON API is not a
second implementation.

### 6.1 Sessions without accounts

`POST /v1/sessions` mints a session and returns a high-entropy token once. Only its hash is
stored. The token lives in the URL fragment or the advisor's browser storage; possession is
authority. Sessions expire (default 30 days, extended on use) and are hard-deleted on
request and on expiry.

This is a deliberate trade from §7 — no accounts in v1 — and it has a cost worth stating:
**a lost token is a lost session.** Mitigation is that the artifact is the point: the PDF and
the JSON are downloaded to the advisor's own machine, and losing the session loses only the
ability to revise it in place.

### 6.2 Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/sessions` | Mint a session token |
| `GET` | `/v1/parcels?county=&pin=&address=&bbox=` | Search the ingested parcel layer |
| `POST` | `/v1/holdings` | Create a holding |
| `POST` | `/v1/holdings/{id}/land-units` | From parcel ids or drawn geometry |
| `PATCH` | `/v1/land-units/{id}` | Water access, fencing, label, tillable override |
| `POST` | `/v1/land-units/{id}/characterizations` | Async: §5.3–5.6 → `202` + job |
| `GET` | `/v1/jobs/{id}` | Job state; `303` to the result when done |
| `GET` | `/v1/characterizations/{id}` | Soils summary, overlays, contiguity, with provenance |
| `GET` | `/v1/threshold-catalogs` · `/{version}` | Catalogs, including citation status |
| `POST` | `/v1/holdings/{id}/threshold-overrides` | Advisor override, with who and why |
| `POST` | `/v1/holdings/{id}/scenarios` | Status quo or subdivision (plan in body) |
| `POST` | `/v1/holdings/{id}/runs` | Async: evaluate, compare, fragment → pinned run |
| `GET` | `/v1/runs/{id}` | `BriefExport` JSON, verbatim from the domain |
| `GET` | `/v1/runs/{id}/brief.pdf` | The deliverable |
| `GET` | `/v1/datasets` | Vintages, retrieval dates, staleness state |
| `GET` | `/healthz` · `/readyz` | Liveness; readiness includes "reference data present" |

`GET /v1/runs/{id}` returns exactly the structure `buildBrief` produces. The API adds no
fields, renames nothing, and computes nothing — the documented JSON export of §5.6 and the
API response are the same artifact, so the analysis survives the product whether it was
saved from a browser or fetched from the API.

### 6.3 Writes are idempotent

Every `POST` accepts a client-generated `Idempotency-Key`; a repeat within 24 hours returns
the original result rather than creating a second holding. This is not ceremony: it is the
direct answer to a rural connection dropping mid-request in a meeting, which is the failure
mode §6 names.

### 6.4 Staleness is a response field, not a log line

Any response carrying derived values includes the dataset vintages behind them and a
staleness state (`current` | `review-due` | `stale`) computed from `review_by`. Past `stale`,
the API keeps serving the number and marks it; it does not answer confidently and it does not
refuse. Phase 3's rule records get the same treatment with effective-date ranges.

---

## 7. Reproducibility

**Invariant:** re-evaluating a run from its pinned inputs — same characterizations, same
catalog version, same overrides, same code version — reproduces a byte-identical brief
except `generatedAt`.

This is testable and should be a test: build a run, re-evaluate, compare canonical JSON
hashes. It is what makes the audit trail meaningful, it catches accidental nondeterminism
(map iteration order, floating-point accumulation order, locale-dependent formatting), and
it is the reason `brief_hash` is stored.

Consequences to accept up front:

- Canonical JSON serialization (sorted keys, fixed number formatting) is required. Write it
  once, test it.
- The clock and id generator are ports. The domain never calls `Date.now()`; `buildBrief`
  already takes `generatedAt` as an argument, and that pattern extends outward.
- A new SSURGO vintage does not alter an old run. It produces a new characterization and a
  new run, and the brief in the landowner's file cabinet stays exactly what it said.

---

## 8. ETL

Per §7: never query external services at request time. These datasets change annually at
most, and their availability is unreliable at exactly the moment an advisor is in a meeting.

**Sequence, per dataset and scope:**

1. Download to a working directory; record URL, retrieval time, and checksum.
2. Load into a staging table (`ogr2ogr` or `shp2pgsql` into `reference_staging`).
3. Normalize vocabularies; **fail the load** on any unmapped drainage class, farmland class,
   or drainage/slope aggregation we do not recognize.
4. Validate geometry (`ST_IsValid`), reproject nothing (store 4326), index.
5. Run assertions: row counts within tolerance of the previous vintage, total area within
   tolerance, no empty geometries, spot-check known parcels.
6. Insert `dataset_version`, mark the prior version `superseded_by`, swap in one transaction.

Loads are idempotent by `(dataset, scope, vintage)`. Reloading is a no-op unless the
checksum differs, and a differing checksum for the same published vintage is an error worth
a human look.

**Sources and cadence:**

| Dataset | Source | Cadence | Notes |
| --- | --- | --- | --- |
| SSURGO / gSSURGO | USDA-NRCS | Annual | NCCPI from the Valu1 table; verify column names per vintage |
| County parcels | Each county | Varies; quarterly at best | **Licensing must be settled per county before ingestion** (spec open question 3) |
| FEMA NFHL | FEMA | Irregular | Floodplain overlay |
| NHD | USGS | Irregular | Hydrography; feeds the tillable mask |
| NWI | USFWS | Irregular | Wetlands; feeds the tillable mask and the hydric cross-check |
| Cropland Data Layer | USDA-NASS | Annual | Cultivated mask for tillable extent; 30 m, coarse at edges |

Washtenaw only for Phase 1. Jackson, Lenawee, and Hillsdale follow in Phase 4, driven by
advisor demand, and each is gated on its own licensing answer rather than on our schedule.

---

## 9. Offline tolerance — what is actually promised

§6 asks that a session survive a dropped connection. A server-rendered app with PostGIS
behind it cannot honour that in the strong sense: nothing in the browser can intersect a
parcel with SSURGO. Rather than pretend, the promise is narrowed to three concrete
guarantees:

1. **No work is lost.** Session state is server-side and every write is idempotent. A
   reconnect resumes where the advisor was; a retried submit does not duplicate.
2. **The artifact is on the device early.** As soon as a run completes, the PDF and the JSON
   are downloaded to the advisor's laptop. Nothing about reading a brief in a farmhouse
   kitchen requires the network afterwards.
3. **Degraded mode is visible.** When the API is unreachable, the page says so plainly and
   keeps the last fetched view readable, rather than showing a stale form that silently
   fails on submit.

An offline-capable client is a different product. If Phase 0 says advisors work in places
with no signal at all — a real possibility in Hillsdale — that is a finding that changes the
architecture, and it is better to hear it in Phase 0 than to half-build for it now.

---

## 10. PDF

Same HTML templates as the web view, rendered by headless Chromium with CSS Paged Media.
One template, two outputs, no divergence between what the advisor saw and what the landowner
carries away.

- **Maps are rendered server-side from ingested layers** — parcel outline, soils, shares —
  as static images stored in the object store. No external tile service: it would violate
  §7's "never query external services at request time", and basemap licensing for a printed
  deliverable is a question we do not need to have.
- **Archival format.** A succession decision is a twenty-year artifact; render to PDF/A-2b
  (post-process with Ghostscript, verify conformance in CI) so it is still openable when
  this product is not.
- Rendering is a worker job. Budget 20 seconds; it is not on a request path.
- The PDF embeds the run id and brief hash, so a printed page can be tied back to the run
  that produced it.

---

## 11. Non-functional targets

| Concern | Target | Note |
| --- | --- | --- |
| Parcel search | < 500 ms p95 | Indexed lookup on ingested data |
| Characterization | < 10 s for a 500-acre holding | Async; advisor sees progress |
| Scenario run | < 5 s | Domain is in-memory and fast; this is mostly I/O |
| PDF render | < 20 s | Async |
| Concurrency | Single-digit simultaneous sessions | Five MIFarmLink field staff statewide |
| Database size | Single-county reference data in the low tens of GB | One Postgres instance, one volume |
| Backups | Nightly full, PITR retained 30 days | Reference data is re-derivable; `working` is not |
| Restore drill | Quarterly, timed | An untested backup is not a backup |

---

## 12. Security and data protection

No accounts does not mean no threat model.

- **Tokens:** 256-bit, stored hashed, constant-time compared, never logged. Rate-limit
  session creation and parcel search by IP.
- **No enumeration:** all working-schema ids are UUIDv7 and access requires the session
  token. An unknown id and a forbidden id return the same `404`.
- **Minimal PII:** no owner names ingested; advisors are asked for a session label, not a
  client name. What identifies a landowner here is the parcel itself, which is public
  record — but the *combination* of a parcel and a succession scenario is not, and it is
  treated as confidential.
- **Deletion:** a session and everything under it is hard-deleted on request. The audit trail
  survives as run id, versions, and brief hash — enough to prove what the tool said, holding
  nothing about whose land it said it about.
- **Encryption:** TLS in transit, volume encryption at rest, object store private.
- **Dependencies:** the smaller the surface the better; this project has no reason to carry a
  large dependency tree, and the domain core currently carries none.

---

## 13. Testing

| Layer | Approach |
| --- | --- |
| Domain | Already done: 71 unit tests, no I/O |
| Spatial | Golden tests against known ground — Maple Hill and the family farm. Fixtures are small geometry files committed to the repo, not a live database dump |
| Contiguity | Parameter sweep over `$gap`; assert the fragmentation threshold is stable across a plausible range, and fail loudly if it is not |
| ETL | Contract tests per dataset on a small clipped extract; vocabulary normalization must be exhaustive |
| API | Contract tests per endpoint, including idempotency replay and the `404`-for-forbidden rule |
| Reproducibility | Re-evaluate a pinned run; assert identical canonical JSON |
| Invariant | Property test: for any parcel and any N, an enterprise the model reports lost under an equal-acreage split is also lost under every explicit split of the same parcel into N equal-acreage shares — the upper-bound soundness property the domain claims |

The last one is worth the effort. It is the property the whole product's credibility rests on
and it is currently asserted by argument rather than by test.

---

## 14. Build order

| Phase | Backend deliverable |
| --- | --- |
| **0** | None. Kill-or-confirm conversations come first and still have not happened. |
| **1a** | Postgres + PostGIS, migrations, SSURGO + Washtenaw parcel ETL, `dataset_version` pinning |
| **1b** | Land unit from parcels, soil attachment, **contiguity prototype and calibration** (§5.4) |
| **1c** | Characterization API + server-rendered intake and soils view |
| **2a** | Scenarios, runs, pinned briefs, JSON export |
| **2b** | PDF pipeline, server-side maps, PDF/A |
| **2c** | Advisor-drawn and field-boundary splits feeding explicit plans |
| **3** | Rule records with effective-date ranges; PA 116, ACEP-ALE, PDR scenarios |
| **4** | Additional counties, each gated on its own licensing answer |

1b is the one that can invalidate the plan. If contiguity cannot be computed defensibly, the
fragmentation number — the reason the product exists — cannot be either, and that is worth
knowing in week three rather than month six.

---

## 15. Open questions

1. **Which counties will actually license parcel data, and on what terms?** Unchanged from
   the narrowed spec, and it now gates a concrete ETL job. Washtenaw first; the answer for
   one county does not predict the next.
2. **Is the CDL good enough to derive tillable extent,** or does every holding need an
   advisor to draw the fields? This decides whether Phase 1 is usable unattended or is
   always a two-person exercise. Test it against Maple Hill before building around it.
3. **How much does `$gap` move the answer?** If the fragmentation threshold swings with a
   plausible parameter change, the headline number is softer than it looks and the brief
   must say so.
4. **Do advisors need to revisit a session weeks later?** If yes, token-only access is too
   fragile and accounts move from Phase 3 to Phase 2 — a change §7 explicitly resists, so
   the evidence should be real before making it.
5. **Where does this run?** A single VM is adequate and cheapest; managed Postgres with
   PostGIS is less work to operate. This is unresolved because it depends on open question 1
   in the narrowed spec — who pays — and that is still unresolved too.

---

## 16. Least confident about

- **The contiguity computation.** It is the linchpin, it has a tunable parameter, and no
  version of it has been run against real ground yet.
- **That the map unit is a fine enough atom.** Flattening SSURGO components loses real
  variation, and the loss is invisible in the output unless we go looking for it.
- **The offline narrowing in §9.** It is honest, but it may not be what "a session must
  survive a dropped connection" was asking for.
- **That the ETL is a week of work rather than a month.** Four datasets, each with its own
  delivery format, projection quirks, and vocabulary. This kind of work is reliably
  underestimated, and this document is not an exception to that.
