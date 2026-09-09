/**
 * The one place that reads bytes. Validation lives in the domain
 * (`parseThresholdCatalog`), so a catalog loaded from a file, a database row, or
 * an advisor's edit form is checked the same way.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseThresholdCatalog } from '../domain/thresholds.ts';
import type { ThresholdCatalog } from '../domain/enterprise.ts';

export const DEFAULT_CATALOG_FILE = fileURLToPath(
  new URL('./enterprise-thresholds.v1.json', import.meta.url),
);

export function loadThresholdCatalog(path: string = DEFAULT_CATALOG_FILE): ThresholdCatalog {
  return parseThresholdCatalog(JSON.parse(readFileSync(path, 'utf8')));
}
