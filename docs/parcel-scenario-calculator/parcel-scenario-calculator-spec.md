# Parcel Scenario Calculator — Narrowed Specification

**Version:** 0.1 (draft)
**Date:** September 2, 2026
**Owner:** Bradley — Maple Hill Farm
**Supersedes:** §5.2 and §5.5 of *Succession Planner — Product & Technical Specification* v0.1
**Companion:** `succession-planner-competitive-analysis.md`

---

## 0. Why this document exists

The original Succession Planner spec described a product that is roughly 70% redundant with two free incumbents — MIFarmLink for land–operator matching, AgTransitions for narrative transition planning. See the companion competitive analysis for the evidence.

What survived the competitive check is one capability neither incumbent provides: **parcel-specific, geospatially-grounded, quantitative comparison of land disposition scenarios.** Existing tools are questionnaires and workbooks — text in, text out. None of them read the soil under a specific parcel and tell the owner what a four-way split actually does to it.

This spec covers only that. Everything else is explicitly ceded.

---

## 1. Problem statement

A Michigan landowner deciding what to do with 180 acres has these options: leave it alone, divide it among heirs, enroll in PA 116, donate or sell a conservation easement (ACEP-ALE, county PDR), lease it out, or sell it. Each has different consequences for what the land can produce, what it costs now, and what is permanently foreclosed.

Today, evaluating those options requires manually pulling soils data from USDA Web Soil Survey — NRCS's own ACEP-ALE guidance instructs applicants to calculate prime-soil percentages by hand in Web Soil Survey or to consult a local office — cross-referencing county parcel records, and reasoning about program rules from PDFs. The output is a narrative, produced by an advisor over multiple meetings, and it is not comparable across options.

**The gap: nobody turns parcel geometry + soils + program rules into a side-by-side quantitative comparison.**

The most consequential single number nobody computes: *at what point does subdivision drop each parcel below the minimum viable acreage for the enterprises the land can actually support?* That is the fragmentation decision, and it is currently made on intuition.

---

## 2. Positioning

This is **not** a competitor to MIFarmLink or AgTransitions. It is an upstream input to both.

```
[Parcel Scenario Calculator]
        │
        ├──> PDF brief ──> attorney / conservancy meeting
        ├──> informs ────> AgTransitions narrative plan
        └──> informs ────> MIFarmLink listing (what to list, what to protect first)
```

Design consequence: **export quality is a first-class requirement, not a feature.** The product's value is realized in a document someone carries into a meeting with a different tool or a different person. If the PDF is weak, the product is worthless regardless of how good the model is.

---

## 3. Users — revised

The primary user is no longer the landowner.

**Primary — the Advisor.** MIFarmLink field staff (five statewide as of the MACD integration), Conservation District staff, Legacy Land Conservancy staff, MSU Extension educators. They sit with landowners, they already own the client relationship, and they currently do this analysis by hand or not at all. Technically capable, time-constrained, working in a meeting.

**Secondary — the Landowner.** Views output; may enter parcel data with advisor help. Does not need an account in v1.

**Removed from scope:** the Operator persona entirely. That is MIFarmLink's user.

**[ASSUMPTION — the load-bearing one]** That advisors actually want this and don't already have a workaround. Unvalidated. §8 addresses it.

---

## 4. Scope

### In

- Parcel identification and geometry
- Automatic SSURGO soil attachment and derived productivity/drainage/prime-farmland metrics
- Enterprise viability thresholds by soil and acreage
- Subdivision modeling with viability impact
- Program eligibility indication (PA 116, ACEP-ALE, Washtenaw PDR) with cited rules
- Side-by-side scenario comparison
- PDF brief export

### Out — permanently, not "later"

- **Land–operator matching.** MIFarmLink. Not competing.
- **Narrative transition planning, family goal-setting, heir invitation flows.** AgTransitions, free since 2015, already supports granting reviewer access and sharing with family.
- **Valuation and appraisal.** Liability, and requires market data we won't have.
- **Legal or tax advice.** Output is questions and indications, never answers.
- **Financial statements, cash flow, farm accounting.** FINPACK/CFFM territory.
- **Conservancy portfolio and easement stewardship management.** Landscape (landconservationsoftware.com) already does parcel management, county parcel layers, and geospatial queries for land trusts.
- **User accounts, in v1.** Advisor-driven sessions; see §5.

---

## 5. Functional requirements

### 5.1 Parcel intake

- Locate by county parcel ID, address, or map draw.
- Target counties for v1: **Washtenaw, Jackson, Lenawee, Hillsdale.** Parcel data licensing varies by county and some Michigan counties treat GIS data as a revenue line — verify before ingestion (see companion doc, open question 3).
- Multi-parcel Holdings supported; most real farms are several parcels.

### 5.2 Soil and land characterization

- SSURGO ingestion: map units, slope class, drainage class, NCCPI, hydric flag, prime/unique/important farmland classification.
- Compute prime-farmland acreage and percentage — directly reusable in an ACEP-ALE application, where that percentage is a required ranking input.
- Overlay: FEMA floodplain, NHD hydrography, National Wetlands Inventory.
- Every derived value displays source and vintage. Advisors will not trust unattributed numbers.

### 5.3 Enterprise viability model

The differentiating logic. For each enterprise type — row crop, hay, managed grazing, orchard, vegetable, timber, agroforestry — define machine-readable requirements:

- minimum contiguous tillable acres
- drainage class tolerance
- slope ceiling
- water access requirement
- fencing requirement
- productivity index floor

Applied to a parcel, this yields a **supported-enterprise set**. Applied to a *subdivided* parcel, it yields the set that survives the split. The delta between those two sets is the headline output of the product.

Thresholds must be **data, not code** — sourced from MSU Extension budgets and enterprise budgets, versioned, cited, and adjustable by an advisor who disagrees. An advisor who cannot override a threshold will stop trusting the tool the first time it is wrong about their county.

### 5.4 Scenario engine

Scenarios for v1, deliberately fewer than the original spec:

1. **Status quo** — baseline supported-enterprise set.
2. **Subdivision (N ways)** — user specifies heir count and split method (equal acreage, equal value, along existing field boundaries). Output: resulting parcel geometry, per-parcel supported-enterprise set, and which enterprises are lost.
3. **PA 116 enrollment** — tax deferral, term, and **recapture exposure displayed prominently**. This is where a landowner gets hurt by an incomplete picture.
4. **Conservation easement (ACEP-ALE or conservancy-held)** — development rights extinguished, permitted uses retained, prime-soil percentage computed against ranking criteria, competitive-application timeline noted.
5. **Washtenaw County PDR** — same shape, county-specific criteria.

Each scenario renders a consistent structure: what the land can still do, what is irreversible, what it costs, what the timeline is, and **who to call next**.

Scenarios must be comparable in a single view. Comparability is the product.

### 5.5 Rules as versioned data

PA 116 terms, ACEP-ALE eligibility and ranking factors, PDR criteria — all encoded as rule records with effective-date ranges and citations to source documents. When a rule's data is stale past a threshold, the product says so rather than answering confidently. Hard-coding these guarantees silent wrongness within two years.

### 5.6 Output

- **PDF brief** — the actual deliverable. Parcel map, soils summary, scenario comparison table, per-scenario detail, sources and vintages, referral list. Designed to be printed and put on a table.
- **JSON export** — documented schema, so the analysis survives the product.
- No dashboards, no login-required viewing, no email drip. The artifact is the point.

---

## 6. Non-functional requirements

- **Accessibility:** WCAG 2.2 AA floor. Large targets, high contrast, plain language. Advisors' clients skew 55–80.
- **Offline tolerance:** rural connectivity is uneven; a session must survive a dropped connection.
- **Provenance everywhere:** source and vintage on every derived figure.
- **Longevity:** PDF plus documented JSON. A succession decision is a 20-year artifact.
- **Liability discipline:** every eligibility output is indicative, phrased as a question for a named professional. Copy is a compliance surface as much as code is. Audit trail of what the tool said and when.

---

## 7. Architecture

Deliberately boring. Low write volume, low concurrency, high durability. The complexity is in the domain model and the rule data, not the infrastructure.

- **PostgreSQL + PostGIS.** Non-negotiable — geometry, spatial joins against SSURGO map units, subdivision geometry operations are the entire workload.
- **Batch ETL** for SSURGO, county parcel layers, FEMA/NHD/NWI. Never query external services at request time; these datasets change annually at most and external availability is unreliable.
- **Pure domain layer.** Enterprise viability and scenario logic must be unit-testable with no database. This is where correctness matters and where rules will churn.
- **Backend:** Java (GeoTools ecosystem is materially stronger for geospatial work than Node's) or TypeScript if the geospatial work stays inside PostGIS and the app layer just orchestrates. Decide by prototyping the subdivision geometry operation first.
- **Frontend:** server-rendered; the map is the only genuinely interactive surface.
- **No LLM in the critical path.** Possible later for drafting the "questions for your attorney" list. Never for eligibility, viability, or anything mistakable for advice.
- **No auth in v1.** Advisor-initiated sessions producing a PDF. Accounts are a Phase 3 concern at earliest and a significant abandonment source for this demographic.

---

## 8. Build sequence

**Phase 0 — Kill-or-confirm (do this before any code).**
Talk to Jill Dohner at MIFarmLink/MACD, Legacy Land Conservancy, and the Washtenaw County Conservation District. One question: *when a landowner asks what happens if they split the farm four ways, how do you answer today?*

- If they have a workable method → the gap is not real, stop here.
- If the answer is "we don't, really" → proceed to Phase 1.
- If the answer is "we send them to NRCS and wait" → the gap is real and larger than specced.

**Phase 1 — Parcel + SSURGO + supported-enterprise set.** Single county (Washtenaw). Verify against ground you know: Maple Hill and the family farm. Standalone useful even with no scenarios.

**Phase 2 — Subdivision scenario + PDF brief.** The headline capability and the deliverable, together. This is the minimum thing worth showing an advisor.

**Phase 3 — Program scenarios (PA 116, ACEP-ALE, PDR) with versioned rule data.**

**Phase 4 — Additional counties.** Driven by advisor demand, not ambition.

---

## 9. Open questions

1. **Who pays?** Advisors are grant-funded nonprofits with no software budget. Plausible paths: MACD/MIFarmLink licenses it, a USDA Beginning Farmer and Rancher Development Grant funds it (MIFarmLink was seeded with $45,000 from exactly that program), or it is open-source infrastructure and the revenue is your consulting time. **This determines whether the product is a business or a contribution, and it is still unresolved.**
2. **Does MIFarmLink want to own this rather than partner on it?** They have grant funding, state backing, and MACD's field staff. If they'd build it, the best contribution may be the domain model and the rules data, not a product.
3. **County parcel data licensing** — verify per county before ingestion.
4. **Are enterprise viability thresholds defensible?** MSU Extension budgets exist but "minimum viable acreage" is contested and varies by operator, market, and equipment. An indefensible threshold discredits the whole tool.
5. **Does the PDF actually get used?** Test by producing one by hand for a real parcel and giving it to an advisor before building anything that generates it.

---

## 10. Least confident about

- That advisors want a quantitative tool at all. Their work is relational; a number may be less useful to them than it looks to an engineer.
- That subdivision-to-viability is the question landowners are actually asking. It's the question that is *computable*, which is not the same thing.
- That the four-county SSURGO + parcel ingestion is as tractable as assumed.
- That there is a business here at all. The honest base case is that this is a well-built tool given to nonprofits, with the return being relationships and reputation in the local ag community rather than revenue.
