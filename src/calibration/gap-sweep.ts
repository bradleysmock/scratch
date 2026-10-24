/**
 * Phase 1b calibration harness.
 *
 * Backend spec §5.4 says the erosion gap "is a parameter, not a constant, it
 * changes the answer, and it must be calibrated against ground the owner knows".
 * This sweeps it, pushes each result through the real fragmentation model, and
 * reports whether the advice a landowner would receive changes.
 *
 * Run: PSC_DATABASE_URL=… npm run calibrate -- [landUnitId]
 *
 * Note what this harness can and cannot establish. It can show whether the
 * answer is sensitive to the parameter, which is a property of the algorithm and
 * the geometry. It cannot tell you the right value of the parameter for a real
 * farm — that needs real soils, a real parcel, and someone who has walked it.
 */

import { loadThresholdCatalog } from '../data/catalog.ts';
import { findFragmentationThresholds } from '../domain/fragmentation.ts';
import type { EnterpriseId } from '../domain/enterprise.ts';
import { bracketContiguity, characterizeLandUnit } from '../spatial/characterize.ts';
import { closePool, isDatabaseConfigured } from '../spatial/db.ts';
import { GAP_BRACKET_METRES } from '../spatial/constants.ts';

const DEFAULT_LAND_UNIT = '22222222-2222-4222-8222-222222222222';
const GAPS = [0, 1, 2, 3, 3.5, 4, 5, 7.5, 10, 15];
const DATASET_VERSION_IDS = [1, 2, 3, 4, 5, 6];
const MAX_SHARES = 8;

interface Row {
  readonly gap: number;
  readonly tillableAcres: number;
  readonly contiguousAcres: number;
  readonly blocks: number;
  readonly thresholds: ReadonlyMap<EnterpriseId, number | null>;
}

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) {
    process.stderr.write(
      'PSC_DATABASE_URL is not set. See docs/phase-1b-findings.md for the local PostGIS setup.\n',
    );
    process.exitCode = 1;
    return;
  }

  const landUnitId = process.argv[2] ?? DEFAULT_LAND_UNIT;
  const catalog = loadThresholdCatalog();
  const enterprises = catalog.requirements.map((requirement) => requirement.id);

  const rows: Row[] = [];
  for (const gap of GAPS) {
    const characterization = await characterizeLandUnit(landUnitId, {
      datasetVersionIds: DATASET_VERSION_IDS,
      gapMetres: gap,
    });
    const report = findFragmentationThresholds(characterization.landUnit, catalog, {
      maxShares: MAX_SHARES,
    });
    rows.push({
      gap,
      tillableAcres: characterization.tillableAcres,
      contiguousAcres: characterization.landUnit.contiguousTillableAcres?.acres ?? 0,
      blocks: characterization.contiguityMethod.blockCount,
      thresholds: new Map(
        report.thresholds.map((threshold) => [threshold.enterprise, threshold.maxSharesSupported]),
      ),
    });
  }

  const first = rows[0];
  if (first === undefined) throw new Error('No sweep rows were produced.');

  const characterization = await characterizeLandUnit(landUnitId, {
    datasetVersionIds: DATASET_VERSION_IDS,
  });

  heading(`Gap sweep — ${characterization.landUnit.label}`);
  line(
    `${characterization.landUnit.acres.toFixed(1)} acres total · ` +
      `${first.tillableAcres.toFixed(1)} tillable acres · ` +
      `tillable extent from the ${characterization.contiguityMethod.tillableSource}`,
  );
  line('');

  const header =
    pad('gap (m)', 9) +
    pad('largest block', 16) +
    pad('blocks', 8) +
    enterprises.map((id) => pad(abbreviate(id), 13)).join('');
  line(header);
  line('-'.repeat(header.length));
  for (const row of rows) {
    line(
      pad(row.gap.toFixed(1), 9) +
        pad(`${row.contiguousAcres.toFixed(2)} ac`, 16) +
        pad(String(row.blocks), 8) +
        enterprises
          .map((id) => pad(formatThreshold(row.thresholds.get(id) ?? null), 13))
          .join(''),
    );
  }
  line('');
  line('Columns are the largest number of equal shares at which the enterprise is still');
  line('supported outright. "none" means it is not supported even undivided.');

  heading('Does the parameter change the advice?');
  const moved = enterprises
    .map((id) => {
      const values = rows.map((row) => row.thresholds.get(id) ?? null);
      const distinct = [...new Set(values.map((value) => String(value)))];
      return { id, values, distinct };
    })
    .filter((entry) => entry.distinct.length > 1);

  if (moved.length === 0) {
    line('No. Every fragmentation threshold is stable across the swept range.');
  } else {
    for (const entry of moved) {
      const lowest = entry.values.reduce<number | null>(
        (min, value) => (value === null ? min : min === null ? value : Math.min(min, value)),
        null,
      );
      const highest = entry.values.reduce<number | null>(
        (max, value) => (value === null ? max : max === null ? value : Math.max(max, value)),
        null,
      );
      line(
        `${pad(entry.id, 20)} moves between ${formatThreshold(lowest)} and ${formatThreshold(
          highest,
        )} shares across the swept range.`,
      );
    }
    line('');
    line('A threshold that moves with the parameter is not a finding about the land. It is a');
    line('question about a narrow crossing somewhere on the parcel, and it has to be settled');
    line('by someone standing on it.');
  }

  heading('Bracketed reading');
  const bracket = await bracketContiguity(landUnitId, {
    datasetVersionIds: DATASET_VERSION_IDS,
  });
  line(
    `permissive (${bracket.permissive.gapMetres} m): ${bracket.permissive.acres.toFixed(2)} ac · ` +
      `strict (${bracket.strict.gapMetres} m): ${bracket.strict.acres.toFixed(2)} ac · ` +
      `spread ${(bracket.spread * 100).toFixed(1)}%`,
  );
  line(
    bracket.crossingDependent
      ? 'crossing-dependent: carry the permissive figure (it is the upper bound, which keeps loss\n' +
          'claims sound) and put the crossing on the list of things to confirm on site.'
      : 'not crossing-dependent: the two ends of the plausible range agree.',
  );
  line('');
  line(`Default bracket: ${GAP_BRACKET_METRES.join(' m and ')} m.`);

  await closePool();
}

function formatThreshold(value: number | null): string {
  return value === null ? 'none' : String(value);
}

function abbreviate(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 11)}.`;
}

function heading(text: string): void {
  process.stdout.write(`\n${text}\n${'='.repeat(text.length)}\n`);
}

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)} ` : text.padEnd(width);
}

await main();
