# Field Allocation Model — Specification

**Version:** 0.1 (draft)
**Date:** September 2, 2026
**Owner:** Bradley — Maple Hill Farm
**Working name:** placeholder; "input-cost forecasting" undersells and overpromises simultaneously

---

## 0. Read this section before the rest

**This is the most crowded of the three ag-tech concepts examined so far.** The succession space had two incumbents. This one has at least a dozen, several well-funded, and two free tools from land-grant universities that do a large fraction of what was proposed.

The competitive picture is in §1 rather than an appendix because it should change what gets built, not merely inform it. The spec that follows §1 is deliberately narrower than the original concept and may still not clear the bar.

---

## 1. Competitive reality

### 1.1 Commercial incumbents

| Product | Position | Price | Overlap with concept |
|---|---|---|---|
| **Harvest Profit** | Built around which acres actually make money; field-level margin, breakeven from actual market data, grain marketing plan builder | From $1,600/year | **Very high** — this is close to the proposed product, already built |
| **Traction Ag** | Cloud accounting on crop-year logic; acquired Conservis 2023, folding field-level management into financials; breakeven per acre and per bushel | ~$100–500+/mo | High |
| **Granular** | Financial planning, budgeting, profitability analytics, explicitly optimized for large-scale operations | Enterprise | High, but wrong scale |
| **Farmers Business Network** | Input purchasing with price transparency, market benchmarking, financing | Varies | Partial — owns the input-price-transparency piece |
| **Figured** | Forecasting and scenario planning layered on Xero/QBO | $90/mo + fields | Partial — scenario planning, no agronomy |
| **Ambrook** | Accounting for modern small/mid farms and ranches | $29–49/mo per entity | Partial — accounting, not decision modeling |

### 1.2 Free institutional tools — the real problem

**farmdoc FAST Tools (University of Illinois).** A suite of Excel spreadsheets for financial analysis and evaluating management decisions. Directly relevant members, several updated in 2026:

- **Farm Projection Tool** (May 2026) — per-acre budgets by crop plus whole-farm budget, breakevens, projected financial statements, return sensitivities, and analysis of crop insurance and hedging effects
- **Planting Decision Model** (May 2026) — cost of planting corn and soybeans by planting date, net returns from replanting, prevented planting payments, and crop rotation comparison
- **Cash Rent with Bonus Worksheet** (Feb 2026) — cash rents under alternative price and yield scenarios
- **Grain Pricing Tool** — future price distributions, storage breakevens, net returns across delivery locations and months
- **Machinery Economics** (Jan 2026) — fieldwork cost and machinery costs

**CFFM CropCost (University of Minnesota).** Free. Identifies cost of production per crop and breakeven cost, aimed at marketing and pricing decisions. Same institution as AgTransitions and FINPACK.

Between them, these two free suites cover: cost of production, breakeven, price sensitivity, rotation comparison, cash-rent-vs-farm comparison, and the plant/don't-plant decision. **The original concept — "track input costs against historical yield and current futures prices to decide whether to plant, lease, or fallow" — is substantially the Farm Projection Tool plus the Cash Rent Worksheet, both free and both updated four months ago.**

### 1.3 Honest conclusion

The proposed product, as described, should not be built. It is a paid reimplementation of free university tools and a cheaper version of Harvest Profit.

Three things about the incumbents are nonetheless weak, and §2 narrows to those. Whether they are weak *enough* to justify a build is unresolved and probably negative.

---

## 2. What is actually left

### Gap A — Scale and enterprise mismatch

Every commercial tool above is built for row-crop commodity operations. Granular is explicitly for large-scale farming; Harvest Profit's core artifacts are grain marketing plans and per-bushel breakevens; Traction Ag is described as fitting crop-heavy farms with real acreage.

Nothing serves the operator with 5–200 acres running mixed enterprises — pasture, sheep, hay, vegetables, orchard — where revenue is direct-market rather than commodity, price is set rather than discovered, and there is no futures contract for lamb sold at the farm gate.

This is your own situation and the situation of most Washtenaw County small farms.

### Gap B — Michigan parameterization

FAST Tools are Illinois-parameterized; CropCost is Minnesota's. Both are portable in principle. Both require the operator to source Michigan-specific yields, custom rates, and cash rents themselves — from MSU Extension budgets, USDA NASS, and county averages — and enter them by hand.

### Gap C — The allocation decision itself

The incumbents answer *what does this crop cost and what is breakeven*. That presumes the field is being cropped.

The decision this spec targets is upstream: **for each field, what is the best use this season across a heterogeneous option set** — plant enterprise X, cash-rent it out, put it in hay, graze it, enroll it in CRP, or leave it fallow? Those options have incommensurable revenue structures, and no tool found compares them in one view. FAST's Cash Rent worksheet gets closest but compares rent scenarios, not rent against a full alternative-use set.

**Gap C is the only genuinely novel piece. A and B are localization, not innovation.**

---

## 3. Scope

### In

- Field register with acreage and soil-derived productivity (shares the SSURGO layer from the Parcel Scenario Calculator spec)
- Enterprise option library with cost and revenue structures, including non-commodity direct-market forms
- Per-field, per-season allocation comparison across heterogeneous options
- Sensitivity analysis on the two or three variables that actually move the answer
- Michigan-parameterized defaults, cited and overridable

### Out

- **Accounting and bookkeeping.** Ambrook, Traction Ag, QuickBooks, FarmBooks. Never build this.
- **Grain marketing plans, hedging, storage economics.** Harvest Profit and FAST's Grain Pricing Tool. Requires commodity expertise not present.
- **Live futures integration.** Deferred deliberately — see §5.
- **Agronomic recommendations** (nitrogen rates, irrigation). CropManage and others; different discipline, different liability.
- **Benchmarking against other farms.** Requires a user base that will not exist.
- **Machinery cost modeling.** FAST Machinery Economics, free, January 2026.

---

## 4. Functional requirements

### 4.1 Field register

- Fields as named polygons with acreage; SSURGO attachment for productivity index and drainage class.
- Shares the ingestion layer with the Parcel Scenario Calculator. If both are built, they are one data platform with two decision surfaces — that shared substrate is the strongest argument for building either.

### 4.2 Enterprise option library

Each option carries a **revenue structure type**, and this typing is the design crux:

- **Commodity yield × price** — corn, soybeans, wheat. Price from a user-entered forward or cash bid.
- **Fixed rent** — cash lease. Revenue is certain; cost is near zero. The baseline every other option must beat.
- **Direct-market unit** — lamb, wool, produce, eggs. Price is set by the operator, quantity is capacity-limited, and **the binding constraint is market access, not production.**
- **Per-unit livestock on pasture** — stocking rate × per-head margin, bounded by carrying capacity.
- **Program payment** — CRP, EQIP, cover-crop incentives. Fixed per acre, with enrollment terms.
- **Fallow** — zero revenue, non-zero cost (mowing, weed control), non-zero benefit (soil, deferred).

Costs decompose into: seed/stock, fertility, chemical, custom or machine operations, labor hours, fencing/infrastructure amortization, and land charge.

**The land charge is non-optional.** Owned ground has an opportunity cost equal to what it would cash-rent for. Omitting it is the single most common error in farm enterprise analysis and makes every owned-land enterprise look profitable.

### 4.3 Allocation comparison

For a selected field, render every feasible option side by side:

- expected net return per acre
- **return per labor hour** — the binding constraint for an operator with 10 hours a week, and a figure the commodity-oriented incumbents largely ignore
- capital required up front
- downside case
- what the option commits (multi-year lease, CRP enrollment term, fencing investment, breeding stock)

Feasibility filtering uses the enterprise viability model from the Parcel Scenario Calculator spec — an option requiring water access on a field without it does not appear.

### 4.4 Sensitivity

Not a full Monte Carlo. Identify the two or three inputs whose variation actually changes the ranking, and show the range over which the ranking holds. **The useful output is "this decision flips if lamb drops below $X," not a probability distribution.** Operators act on thresholds, not distributions.

### 4.5 Michigan defaults

- Seed as versioned, cited defaults from MSU Extension enterprise budgets, USDA NASS county yields, and published custom rates.
- Every default shows source and vintage and is overridable, with overrides persisting.
- When a default is stale past a threshold, say so rather than presenting it confidently.

---

## 5. Deliberate deferral: futures prices

The original concept named current futures prices as an input. This is deferred, for three reasons:

1. **Real-time market data is a licensing and cost problem** disproportionate to a small tool.
2. **It is the wrong input for the target user.** A direct-market sheep operation has no futures contract. Futures matter to the commodity row-crop operator, who is already served by Harvest Profit and FAST.
3. **A user-entered forward bid or local elevator price is more accurate** than a futures price for anyone actually deciding what to do with a field, because it reflects basis.

If commodity operators turn out to be the real user, this decision reverses — and if that happens, the product is Harvest Profit and should not be built.

---

## 6. Architecture

- Shares PostgreSQL + PostGIS and the SSURGO/parcel ETL with the Parcel Scenario Calculator. **If that platform is not built, this project's infrastructure cost roughly doubles and its case weakens accordingly.**
- Enterprise cost/revenue models as versioned, cited data records — never code. Same discipline as the program rules in the other spec.
- Pure, unit-testable calculation layer with no database dependency. The arithmetic is simple; the correctness bar is high, because a wrong land charge or a double-counted labor cost silently produces a confident wrong answer.
- Export to PDF and CSV. Many operators will want the numbers in their own spreadsheet, and fighting that is pointless.
- No live market data feeds in v1 (§5).

---

## 7. Build sequence

**Phase 0 — Prove it against your own operation, by hand.**
You already built a spreadsheet model for a sheep operation on 200 leased acres across wholesale versus direct-market and stocking-rate scenarios, and it identified direct-to-consumer marketing as the key viability lever.

That model *is* the prototype. Before writing code:

1. Extend it to compare sheep against cash rent, hay, and fallow on the same ground.
2. Add the land charge and return-per-labor-hour lines.
3. Run the Farm Projection Tool and CropCost on the same numbers.

If the free tools give you the same answer, stop — the gap is illusory. If your spreadsheet answers something they can't, that difference is the entire product and should be written down precisely.

**Phase 1 — Field register + enterprise library + single-field comparison.** Only for the enterprise types you actually run.

**Phase 2 — Sensitivity thresholds.**

**Phase 3 — Michigan default library.** The most tedious work and the most defensible moat, because it is data curation rather than code.

**Phase 4 — Multi-field whole-farm allocation under a labor constraint.** Genuinely interesting as an optimization problem and genuinely premature.

---

## 8. Open questions

1. **Is Gap C real, or is it just an unbuilt view of tools that already have the data?** Harvest Profit tracks field-level margin; whether it compares cropping against cash rent and fallow is unverified from outside. This must be checked hands-on before Phase 1. It could invalidate the entire spec.
2. **Do small diversified operators make this decision analytically at all?** Rotation, personal preference, existing infrastructure, and what the neighbor will rent may dominate. A tool that answers a question nobody asks quantitatively is worthless regardless of correctness.
3. **Is direct-market revenue modelable?** If market access is the binding constraint rather than production capacity, the model must forecast demand — which is much harder than forecasting yield, and may be intractable at this scale.
4. **Who pays, and how much?** Harvest Profit is $1,600/year for operations where a 2% margin improvement covers it many times over. A 40-acre diversified farm cannot pay meaningfully, and the free FAST alternative sets the price ceiling at roughly zero.
5. **Does this collapse into the Parcel Scenario Calculator?** Both compute enterprise viability on a parcel from soils. One asks about this season, the other about the next generation. They may be two views of one model — which would make them one product and materially improve the case for both.

---

## 9. Recommendation

**Do not start this as a product.** Do Phase 0 — it costs a weekend, uses a model you already have, and produces a real answer for Maple Hill either way.

The realistic best case is not a business. It is: a rigorous personal model, a shared data substrate with the Parcel Scenario Calculator, and possibly a contribution to MSU Extension of a Michigan-parameterized budget tool that doesn't exist today. That has real value and none of it requires a company.

The case improves materially in one scenario only: if the Parcel Scenario Calculator gets built and the SSURGO and field-register infrastructure already exists. Then this is a second decision surface on paid-for infrastructure rather than a standalone product competing with free Excel from two land-grant universities.

---

## 10. Least confident about

- That Gap C survives hands-on inspection of Harvest Profit. This is the load-bearing assumption and it is untested.
- That the diversified small operator wants numbers rather than a rule of thumb.
- That return-per-labor-hour is as differentiating as it feels. It may simply be a column the incumbents omit because their users don't want it.
- That any of the three ag-tech concepts examined so far is a business rather than a well-built personal tool. Two of three now point the same direction, which is itself worth taking seriously.
