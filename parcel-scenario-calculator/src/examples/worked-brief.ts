/**
 * A worked brief for a fictional 180-acre holding, printed to the terminal.
 *
 * This is not the PDF. It exists so the model can be read by a person before
 * anything is built to render it — spec open question 5 asks whether the brief
 * gets used at all, and the cheapest way to find out is to put one in front of
 * an advisor. Run it with `npm run example`.
 */

import { loadThresholdCatalog } from '../data/catalog.ts';
import { DISCLAIMERS } from '../domain/brief.ts';
import { findFragmentationThresholds } from '../domain/fragmentation.ts';
import {
  compareScenarios,
  evaluateScenario,
  statusQuoScenario,
  subdivisionScenario,
  type ScenarioEvaluation,
} from '../domain/scenario.ts';
import { homeFarmHolding } from '../testing/fixtures.ts';

const catalog = loadThresholdCatalog();
const holding = homeFarmHolding();
const unit = holding.units[0];
if (unit === undefined) throw new Error('The example holding has no land units.');

const baseline = evaluateScenario(statusQuoScenario(holding), catalog);
const splits: ScenarioEvaluation[] = [2, 4].map((shares) =>
  evaluateScenario(
    subdivisionScenario({ holding, unitId: unit.id, plan: { method: 'equal-acreage', shares } }),
    catalog,
  ),
);
const comparison = compareScenarios(baseline, splits);
const fragmentation = findFragmentationThresholds(unit, catalog, { maxShares: 6 });

const soils = baseline.units[0]?.soils;

heading(`${holding.label} — ${unit.acres.toFixed(0)} acres`);
if (soils !== undefined) {
  line(`Prime farmland: ${soils.primeAcres.value.toFixed(0)} acres (${soils.primePercent.value.toFixed(1)}%)`);
  line(
    `Prime including conditionally prime: ${soils.primeIncludingConditionalPercent.value.toFixed(1)}% — verify the condition before citing this`,
  );
  line(
    `Productivity (NCCPI): ${soils.productivityIndex.value?.toFixed(2) ?? 'not determinable'} over ${(
      soils.productivityCoverage.value * 100
    ).toFixed(0)}% of mapped acres`,
  );
  line(`Source: ${soils.primeAcres.sources[0]?.dataset} (${soils.primeAcres.sources[0]?.vintage})`);
}

heading('What the land can do, by scenario');
const columns = [baseline, ...splits];
line(pad('Enterprise', 46) + columns.map((c) => pad(shortLabel(c), 26)).join(''));
for (const row of comparison.rows) {
  const cells = [
    pad(row.baselineStatus, 26),
    ...row.cells.map((cell) => pad(`${cell.status}${cell.provisional ? ' *' : ''}`, 26)),
  ];
  line(pad(row.label, 46) + cells.join(''));
}
line('* provisional: rests on an estimated upper bound, so the geometry needs checking.');

heading('What a split costs, in capability');
for (const evaluation of splits) {
  const lost = comparison.lostByScenario.get(evaluation.scenario.id) ?? [];
  line(
    `${shortLabel(evaluation)}: ${lost.length === 0 ? 'nothing lost outright' : `loses ${lost.join(', ')}`}`,
  );
}

heading('Fragmentation thresholds');
for (const threshold of fragmentation.thresholds) {
  if (threshold.maxSharesSupported === null) {
    line(
      `${pad(threshold.label, 46)} no threshold — undivided status is already ${threshold.baselineStatus}`,
    );
    continue;
  }
  const blocker = threshold.blockingAtFailure[0];
  line(
    `${pad(threshold.label, 46)} survives up to ${threshold.maxSharesSupported} shares` +
      (threshold.firstFailingShares === null
        ? ''
        : `; at ${threshold.firstFailingShares}, ${blocker?.criterion ?? 'a requirement'} fails (${
            blocker?.observed ?? ''
          })`),
  );
}

heading('Assumptions that carry weight');
for (const assumption of splits[0]?.scenario.assumptions ?? []) line(`- ${assumption}`);
for (const caveat of fragmentation.caveats) line(`- ${caveat}`);

heading('Who to call next');
const asked = new Set<string>();
for (const evaluation of [baseline, ...splits]) {
  for (const referral of evaluation.scenario.referrals) {
    const text = `- ${referral.who}: ${referral.question}`;
    if (asked.has(text)) continue;
    asked.add(text);
    line(text);
  }
}

heading('Please read');
for (const disclaimer of DISCLAIMERS) line(`- ${disclaimer}`);
if (catalog.requirements.some((r) => r.citation.status === 'unverified-placeholder')) {
  line(
    `- Thresholds in catalog ${catalog.version} are unverified placeholders. Do not put this in front of a landowner as a finding.`,
  );
}

function heading(text: string): void {
  process.stdout.write(`\n${text}\n${'='.repeat(text.length)}\n`);
}

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 2)}  ` : text.padEnd(width);
}

function shortLabel(evaluation: ScenarioEvaluation): string {
  return evaluation.scenario.kind === 'status-quo'
    ? 'Status quo'
    : `${evaluation.scenario.units.length}-way split`;
}
