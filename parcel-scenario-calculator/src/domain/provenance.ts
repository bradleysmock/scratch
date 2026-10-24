/**
 * Provenance primitives.
 *
 * Spec §6: "source and vintage on every derived figure." Advisors will not trust
 * unattributed numbers, and a succession brief is a twenty-year artifact — the
 * reader in 2046 needs to know which soil survey vintage produced a percentage.
 *
 * Every value this domain computes is wrapped in `Derived<T>`; there is no
 * unattributed path out of the domain layer.
 */

/** A dataset or document a figure ultimately rests on. */
export interface SourceRef {
  /** Dataset or document name, e.g. "USDA-NRCS SSURGO — Washtenaw County, MI". */
  readonly dataset: string;
  /** Vintage of the data itself, not of our copy. ISO date or survey year. */
  readonly vintage: string;
  /** When we pulled it, if known. */
  readonly retrieved?: string;
  /** Citation detail: report name, table, statute section. */
  readonly reference?: string;
}

/**
 * How much weight a figure can carry.
 *
 * `estimated-upper-bound` is load-bearing for subdivision (see subdivision.ts):
 * it marks a figure that cannot exceed the truth, which is what makes an
 * "enterprise lost" conclusion sound while leaving "retained" provisional.
 */
export type Basis = 'observed' | 'estimated-upper-bound' | 'assumed' | 'unknown';

/** A computed figure with its lineage attached. */
export interface Derived<T> {
  readonly value: T;
  /** Plain-language description of how the value was computed. */
  readonly method: string;
  readonly basis: Basis;
  readonly sources: readonly SourceRef[];
  /** Modelling assumptions a reader must see to judge the figure. */
  readonly assumptions: readonly string[];
}

export function derive<T>(
  value: T,
  method: string,
  sources: readonly SourceRef[],
  options: { basis?: Basis; assumptions?: readonly string[] } = {},
): Derived<T> {
  return {
    value,
    method,
    basis: options.basis ?? 'observed',
    sources,
    assumptions: options.assumptions ?? [],
  };
}

/** A figure the inputs do not support. Distinct from a zero or a false. */
export function indeterminate(
  method: string,
  reason: string,
  sources: readonly SourceRef[] = [],
): Derived<null> {
  return {
    value: null,
    method,
    basis: 'unknown',
    sources,
    assumptions: [reason],
  };
}

/** Union of the sources behind several derived figures, de-duplicated. */
export function mergeSources(...groups: readonly (readonly SourceRef[])[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const group of groups) {
    for (const source of group) {
      const key = `${source.dataset}|${source.vintage}|${source.reference ?? ''}`;
      if (!seen.has(key)) seen.set(key, source);
    }
  }
  return [...seen.values()];
}
