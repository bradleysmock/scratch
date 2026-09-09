# Farm Compliance Recordkeeping — Specification

**Version:** 0.1 (draft)
**Date:** September 2, 2026
**Owner:** Bradley — Maple Hill Farm
**Status:** Written, then argued against. Read §1 and §2 before §4.

---

## 0. Summary finding

**Do not build this.** The competitive and regulatory check produced a triple negative:

1. **Michigan already has a free tool.** CANMaPP, from MSU's Institute of Water Research, is a free online recordkeeping tool for nutrient management planning, built on the NRCS 590 spreadsheet.
2. **The target user has almost no mandatory burden.** MAEAP is voluntary and free, and small livestock facilities under 50 animal units are exempt from siting verification entirely.
3. **The segment with real burden already has vendors.** CAFOs under NPDES permits have consultant-attached software that generates state-compliant forms.

The full spec follows anyway, because §4 contains one narrow idea worth extracting even if the product isn't built, and because writing it out is how the negative gets verified rather than assumed.

---

## 1. Regulatory reality check

The original premise assumed a compliance burden. In Michigan, for the operator this platform targets, that burden is largely absent.

**MAEAP is voluntary, free, and staffed.** It is a voluntary program open to farms of all sizes and commodities, guaranteed confidential by state law, with MAEAP technicians who walk producers through assessment and verification. Verification runs on a multi-year cycle — MDARD verification every three years under the original program design, with Farmstead System recognition good for five years and maintained by reviewing the plan with a MAEAP technician and requesting a farm visit.

The incentive to participate is real but not regulatory: MAEAP-verified farms get statutory protection in TMDL watersheds and legal protections under Right to Farm.

**GAAMPs are voluntary standards, not mandates.** The Michigan Right to Farm Act requires establishment of Generally Accepted Agricultural and Management Practices, and producers who follow them voluntarily gain nuisance protection. Following them is a choice.

**Small operations are explicitly exempt.** Facilities with fewer than 50 animal units are not required to go through site review and verification to conform with the Siting GAAMPs, though they may request it.

**Real mandatory recordkeeping attaches to scale.** The federal picture ties records to animal-unit thresholds — plans required at 100 or more AU, with records of actual manure application practices required at facilities with 100 or more AU. Other states codify this similarly; Minnesota, for example, maintains separate land application record forms for 100–299 AU and for 300 or more.

**Implication:** a 5.5-acre homestead, or a 40-acre diversified farm, has essentially no compliance reporting obligation. The paperwork that exists is voluntary program participation, and a free state technician helps with it.

---

## 2. Competitive landscape

### Michigan — already occupied by the state

**CANMaPP** (MSU Institute of Water Research): a free online recordkeeping tool for nutrient management planning that lets users document, store, review, and update practices, built on the NRCS 590 spreadsheet specifically so NRCS can verify payments for funded practices. It has a reports function covering current and prior years.

That last detail matters: it is designed around NRCS payment verification, which is the actual reason a small operator would keep these records at all — cost-share money.

### Other states — the pattern is Extension-built and free

| Tool | Origin | Notes |
|---|---|---|
| **Ohio Nutrient Management Record Keeper (ONMRK)** | OSU Extension Knox County, Ohio Farm Bureau, Knox County SWCD | Free; syncs phone to web, dropdown quick entry, auto-captures GPS location plus current weather and forecast at time of application; prints records or exports to spreadsheet. Built to satisfy Ohio SB 1 and SB 150 |
| **Manure Tracker** | UW-Madison IPCM | Basic and advanced record modes; spreader capacity, source, method, plus soil condition, temperature, precipitation, driver; computes application rate from load count × capacity ÷ acres; email field-history reports |
| **GoCrop** | University of Vermont, $394,000 USDA NIFA grant | Web/mobile; soil, crop, nutrient data; built after recognizing the pain of handwriting field notes then re-entering them into a spreadsheet |
| **Purdue Manure Management Planner** | Purdue | Free standalone, 34 states, state-specific recommendations, meets NRCS and EPA standards, links to WinMax recordkeeping |
| **Minnesota Online Nutrient Management Tool** | MPCA | Required for permit applicants; replaces the older spreadsheet, whose support ends sometime in 2026 |

**The GPS-plus-weather auto-capture in ONMRK is worth noting specifically** — it is the single best idea in this space, it was built by a county Extension office, and it is free.

### Commercial — attached to consultants, not sold to farmers

**myMANUREapp** (AgVice) is built specifically for Iowa customers, storing MMPs, manure and soil test history, and application records, and automatically generating Iowa DNR–compliant forms.

The business model is instructive: it is a service offering from a nutrient management consultancy, sold to clients who already pay for consulting. Not a standalone SaaS product sold to farmers.

---

## 3. What this means

The space has three segments, and none of them is available:

| Segment | Burden | Who serves them |
|---|---|---|
| Small diversified farm (<50 AU) | Effectively none; voluntary MAEAP | Free MAEAP technician; CANMaPP if they want records |
| Mid-size, cost-share participant | NRCS 590 documentation for payment verification | CANMaPP, built for exactly this |
| CAFO under NPDES | Real, mandatory, penalty-backed | Consultants with attached software (myMANUREapp pattern) |

The original framing — "software eats structured recurring documentation for breakfast" — is true and irrelevant. The work is easy for software, which is why five state Extension services have already done it and given it away.

**The premise error worth naming:** I inferred a compliance burden from the general observation that regulatory paperwork is heavy in agriculture. In Michigan, for small operators, it isn't. That should have been checked before the concept was proposed rather than after.

---

## 4. The one narrow idea worth keeping

Everything above kills the product. One piece survives as a *feature*, not a business.

**Observation capture at the point of work, structured at the moment of entry.**

The GoCrop team's founding insight was the cost of handwriting notes in the field and then re-entering them into a spreadsheet. That double-entry cost is real, and it is not specific to nutrient management. It applies to the paper field forms already in the Maple Hill ag-tech work: livestock health observations, breeding records, pasture rotation, greenhouse conditions, harvest logs.

If the ag-tech platform is going to capture field observations anyway, the compliance angle is not a separate product — it is an **export target**.

### Requirements, scoped as a feature

**4.1 Observation model.** A single generic record type: timestamp, location (auto-captured), field or animal reference, observation type, structured payload by type, free-text note, optional photo. Compliance-relevant types (nutrient application, pesticide application, soil test) get the fields those records require; everything else is farm management.

**4.2 Ambient capture.** Follow ONMRK's lead — GPS location plus current weather and forecast captured automatically at the moment of entry. This costs almost nothing to implement and eliminates the fields most likely to be filled in later, wrongly, from memory.

**4.3 Offline-first.** Entry happens in a field with no signal. Local write, sync on reconnect, no data loss. Non-negotiable and the main engineering cost.

**4.4 Export, not compliance.** Generate:
- CSV shaped for import to CANMaPP where possible
- MAEAP-relevant evidence bundles — the MAEAP assessment forms have a "records or evidence for verification" column; produce records matching what that column asks for
- Plain PDF field history for an NRCS cost-share claim or a MAEAP technician visit

**Explicitly do not** assert compliance, calculate application rates against 590 standards, or generate official forms. That is CANMaPP's job and a liability surface.

**4.5 What is out.** Nutrient recommendation engines, plan authoring, permit workflows, regulatory rule interpretation, anything CAFO-scale.

---

## 5. If it were built anyway — architecture

Included for completeness; the recommendation is still §0.

- Offline-first mobile capture; local store with sync queue. This is 80% of the difficulty.
- Append-only observation log. Compliance records must never be silently edited; corrections are new records referencing the original.
- Shared field register with the Parcel Scenario Calculator and Field Allocation Model specs. Three decision surfaces on one field/parcel substrate is the only coherent story across these four concepts.
- Export adapters as data-driven templates, versioned, so a changed state form does not require a release.
- No rule engine, no eligibility logic, no rate calculation.

---

## 6. Recommendation

**Kill the standalone product.** Fold §4 into the existing ag-tech observation capture as an export capability.

Then do the thing that costs nothing: **request a MAEAP technician visit for Maple Hill.** It is free, confidential by statute, and the technician will tell you exactly which records matter for a farm your size. That is better primary research than any amount of web search, it is useful to the farm regardless of the software question, and it puts you in front of the same Conservation District network that the succession work points at.

---

## 7. The pattern across four concepts

This is the fourth ag-tech concept examined in this thread, and the results are worth stating together rather than one at a time:

| Concept | Finding |
|---|---|
| Succession Planner | ~70% redundant with MIFarmLink and AgTransitions |
| Parcel Scenario Calculator | Narrow real gap; buyer is two navigators statewide |
| Field Allocation Model | Substantially free from farmdoc and CFFM; one unverified gap |
| Compliance Recordkeeping | No gap; state provides free tool and free staff |

**The consistent finding is that agricultural software for small operators is a well-served, largely non-commercial space** — because land-grant universities, Extension services, and USDA grants have been filling it for decades, and because the users who most need help are the least able to pay.

That is not a reason to stop. It is a reason to change the question from "what can I build and sell?" to one of:

- **What do I need for Maple Hill that doesn't exist?** Build it for yourself; publish it if it's good.
- **What would MIFarmLink's two navigators, or a MAEAP technician, actually use?** Ask them. That is a real, small, identifiable user base with real unmet needs.
- **Where is the shared substrate?** Three of the four concepts want the same thing: fields and parcels with soils attached, and structured observations against them. That platform is worth building once, and it makes each decision surface cheap.

The fourth option — that the ag-tech product is a portfolio narrative rather than a business — is worth sitting with honestly. Software contracting is already named as the financial backbone. The farm tooling may be better understood as craft and contribution than as a revenue line, and that framing would change what gets built and how much time it deserves.
