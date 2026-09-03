# Parcel Scenario Calculator — domain core

Pure domain layer for the tool described in
[`docs/parcel-scenario-calculator-spec.md`](docs/parcel-scenario-calculator-spec.md):
enterprise viability (§5.3), subdivision modelling and scenario comparison (§5.4),
the fragmentation threshold (§1), and the JSON brief (§5.6).

No database, no network, no filesystem access anywhere under `src/domain`. The
ETL and PostGIS layers named in §7 supply the inputs; this layer decides what
they mean, and it is the part the spec says must be unit-testable on its own.

```bash
npm install
npm test        # 71 tests, node:test
npm run typecheck
npm run example # a worked brief for a fictional 180-acre holding, printed
```

Requires Node 22.18+ (TypeScript runs directly, via type stripping).

## What is here

| Module | Responsibility |
| --- | --- |
| `domain/provenance.ts` | `Derived<T>` — source, vintage, method, basis, assumptions on every figure (§6) |
| `domain/soil.ts` | SSURGO map units → prime-farmland acreage and percentage, NCCPI, drainage composition (§5.2) |
| `domain/land-unit.ts` | Land units and holdings; geometry reduced to the scalars the model needs |
| `domain/enterprise.ts` | Requirement records, advisor overrides with an audit trail (§5.3) |
| `domain/thresholds.ts` | Catalog validation — a malformed catalog throws rather than defaulting |
| `domain/viability.ts` | The supported-enterprise set. The differentiating logic |
| `domain/subdivision.ts` | Equal-acreage and explicit splits (§5.4) |
| `domain/scenario.ts` | Status quo and subdivision scenarios; side-by-side comparison |
| `domain/fragmentation.ts` | The headline number: at what share count does each enterprise die |
| `domain/brief.ts` | Versioned JSON export with disclaimers attached (§5.6) |
| `data/enterprise-thresholds.v1.json` | Thresholds as data, versioned and cited |

## Three properties worth knowing before you read the code

**Missing data yields `indeterminate`, never a default.** A brief that quietly
treats unrecorded water access as "none" is wrong in a way nobody can see. The
model would rather tell an advisor what it does not know.

**Losses are sound; retentions are provisional.** An equal-acreage split cannot
know which share keeps the creek or the flat ground, so every acreage figure it
derives for a share is an *upper bound* — a share can never hold more contiguous
tillable ground than its proportional share of the parent's largest block. An
enterprise the model reports as lost is therefore lost under any equal-acreage
split of that parcel; an enterprise it reports as retained is retained only if
the geometry cooperates, and the brief marks it provisional.

**Shortfalls capital can cure are reported separately.** "You would need to fence
it" is a different answer from "the slope forbids it", and the spec's binary
supported-set framing would flatten the two.

## Every threshold in this repository is unverified

`data/enterprise-thresholds.v1.json` ships plausible numbers for southern Lower
Michigan, and not one of them has been traced to a published source. Every
citation carries `status: "unverified-placeholder"`, `hasUnverifiedThresholds()`
reports it, and every brief discloses it. This is spec open question 4 —
*an indefensible threshold discredits the whole tool* — encoded rather than
described. Check the figures against MSU Extension enterprise budgets and have
Extension or Conservation District staff review them before any of this reaches
a landowner.

An advisor who disagrees with a threshold overrides it (`applyOverride`), which
records who changed what, from what, and why, against the brief.

## Deliberately not here

- **SSURGO ingestion, parcel layers, PostGIS, PDF rendering.** Phase 1 and 2
  infrastructure. The domain takes soil observations as input, which is exactly
  what the spatial join produces, so the seam is already cut.
- **PA 116, ACEP-ALE, and PDR scenarios.** Phase 3. They need versioned rule
  records with effective-date ranges and citations (§5.5); adding them as code
  here is what §5.5 exists to prevent.
- **Valuation, legal advice, cash flow, accounts.** Permanently out of scope (§4).
  Scenario costs are qualitative and referrals are phrased as questions.

## Two things the spec asks for that this code resolves differently

**Equal-value splitting.** §5.4 lists it as a split method; §4 puts valuation
permanently out of scope. Both are honoured by never computing value: an
equal-value split is expressed as an explicit allocation whose valuation was done
by an appraiser off-platform, and the scenario records that its shares rest on a
valuation this tool cannot check.

**"Minimum contiguous tillable acres."** Tillage does not describe timber or
grazing, so each requirement declares whether its acreage floor is measured
against tillable ground or the whole tract.

## Phase 0 has not happened

The spec is explicit that the kill-or-confirm conversations come before any code.
This domain core exists to be argued with — it makes the enterprise model and the
fragmentation number concrete enough to put in front of an advisor — but it does
not answer whether advisors want a quantitative tool at all.
