# scratch

Working repository for Maple Hill Farm tooling and assorted exercises.

## Projects

| Path | What it is |
| --- | --- |
| [`parcel-scenario-calculator/`](parcel-scenario-calculator/) | Pure TypeScript domain core for the Parcel Scenario Calculator. The only project here with an implementation. |
| [`eligibility.js`](eligibility.js) | Standalone rewrite of a 2026-01-16 code challenge. Unrelated to the farm work. |

## Specifications

All specs live under [`docs/`](docs/). A project with more than one spec gets a
subfolder named for it.

| Spec | Status |
| --- | --- |
| [`docs/parcel-scenario-calculator/`](docs/parcel-scenario-calculator/) — narrowed spec + backend spec | Domain core built; ETL and PostGIS layers not started |
| [`docs/field-allocation-model-spec.md`](docs/field-allocation-model-spec.md) | Draft. Recommends Phase 0 by hand rather than a build |
| [`docs/farm-compliance-recordkeeping.md`](docs/farm-compliance-recordkeeping.md) | Draft |

Each spec carries its own recommendation, and two of the three argue against
building the thing they describe. Read §9 or its equivalent before treating any
of them as a plan.
