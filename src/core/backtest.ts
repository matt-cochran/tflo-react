/**
 * Backtest / what-if core — pure, deterministic replay of one recorded event log
 * against MULTIPLE temporal rule specs, with a diff of the results.
 *
 * Because the engine is pure (no wall-clock, event-time only), replaying the same
 * log against different specs is fully deterministic: the same (log, spec) pair
 * always yields the same signals. That makes "what-if I'd shipped rule B instead
 * of rule A?" a mechanical, side-effect-free computation rather than a re-run of
 * production. This is the latent superpower a pure CEP engine packages for free.
 *
 * No React in this module — it's shared by the `useBacktest` hook and the
 * standalone Node validation proof.
 */
import { type CompiledPattern, type DerivedSignal, Pattern, PatternRuntime } from "./pattern";

/** A minimal event: anything with an event-time `ts`, plus arbitrary fields. */
export type BacktestEvent = { ts: number } & Record<string, unknown>;

/**
 * One rule variant to test. `build` constructs a compiled pattern from a fresh
 * `Pattern` builder — the same shape `usePattern`'s `build` takes — so an
 * existing pattern definition can be reused verbatim as a spec.
 */
export interface BacktestSpec<E extends BacktestEvent = BacktestEvent> {
  /** Stable identifier for this variant; keys the result maps. Must be unique. */
  name: string;
  /** Construct the compiled pattern for this variant. */
  build: (p: Pattern<E>) => CompiledPattern<E>;
  /**
   * Optional event-time reorder buffer lateness (ms), mirroring `usePattern`'s
   * `reorder.maxLateness`. Omit for in-order replay.
   */
  maxLateness?: number;
}

/** Signals present in one spec's output but absent from the other's. */
export interface BacktestDiff {
  /** Signals the compared spec emitted that the baseline did not. */
  added: DerivedSignal[];
  /** Signals the baseline emitted that the compared spec did not. */
  removed: DerivedSignal[];
}

export interface BacktestResult {
  /** Emitted signals per spec name, in emission order. */
  perSpec: Record<string, DerivedSignal[]>;
  /**
   * Baseline (first spec) vs each OTHER spec, keyed by that other spec's name.
   * `added` = in the other but not baseline; `removed` = in baseline but not other.
   */
  diff: Record<string, BacktestDiff>;
}

/**
 * Identity key for a signal in the diff: name + event-time + any stable id-ish
 * payload fields. Two signals are "the same" iff this key matches. We include
 * common identifier fields (`id`, `flowId`, `entityId`, `key`) so signals about
 * different entities at the same instant aren't conflated; the full payload is
 * appended as a deterministic tail so any other distinguishing field still
 * separates them.
 */
export function signalKey(s: DerivedSignal): string {
  const p = s.payload ?? {};
  const id = p.id ?? p.flowId ?? p.entityId ?? p.key ?? "";
  return `${s.name}|${s.ts}|${String(id)}|${stablePayload(p)}`;
}

/** Deterministic JSON of a payload with sorted keys (key order can't affect diff). */
function stablePayload(p: Record<string, unknown>): string {
  const keys = Object.keys(p).sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) obj[k] = p[k];
  return JSON.stringify(obj);
}

/** Replay `log` through one spec's runtime, collecting every emitted signal. */
function runSpec<E extends BacktestEvent>(log: E[], spec: BacktestSpec<E>): DerivedSignal[] {
  const compiled = spec.build(new Pattern<E>(spec.name));
  const rt = new PatternRuntime<E>(compiled, spec.maxLateness);
  const out: DerivedSignal[] = [];
  try {
    for (const e of log) out.push(...rt.push(e));
    out.push(...rt.flush());
  } finally {
    rt.destroy();
  }
  return out;
}

/**
 * Multiset diff of two signal lists, keyed by {@link signalKey}. `added` =
 * signals in `other` not matched in `baseline`; `removed` = signals in `baseline`
 * not matched in `other`. Shared by the backtest (offline) and shadow (live)
 * paths — both ask the same question: "which signals does exactly one side
 * emit?". Exported so `useShadowSpec` reuses the identical diff mechanism.
 */
export function diffSignals(baseline: DerivedSignal[], other: DerivedSignal[]): BacktestDiff {
  const baseCounts = new Map<string, number>();
  for (const s of baseline) baseCounts.set(signalKey(s), (baseCounts.get(signalKey(s)) ?? 0) + 1);
  const otherCounts = new Map<string, number>();
  for (const s of other) otherCounts.set(signalKey(s), (otherCounts.get(signalKey(s)) ?? 0) + 1);

  const added: DerivedSignal[] = [];
  for (const s of other) {
    const k = signalKey(s);
    const remaining = baseCounts.get(k) ?? 0;
    if (remaining > 0) baseCounts.set(k, remaining - 1);
    else added.push(s);
  }
  const removed: DerivedSignal[] = [];
  for (const s of baseline) {
    const k = signalKey(s);
    const remaining = otherCounts.get(k) ?? 0;
    if (remaining > 0) otherCounts.set(k, remaining - 1);
    else removed.push(s);
  }
  return { added, removed };
}

/**
 * Pure backtest core: replay `log` against every spec and diff the first spec
 * (baseline) against each of the others. Deterministic and side-effect-free —
 * the engine must already be initialized (`initTflo()`); no wall-clock is read.
 *
 * @throws if two specs share a `name` (the result maps would collide).
 */
export function runBacktest<E extends BacktestEvent>(
  log: E[],
  specs: BacktestSpec<E>[],
): BacktestResult {
  const perSpec: Record<string, DerivedSignal[]> = {};
  for (const spec of specs) {
    if (Object.prototype.hasOwnProperty.call(perSpec, spec.name)) {
      throw new Error(`useBacktest: duplicate spec name "${spec.name}" (names must be unique)`);
    }
    perSpec[spec.name] = runSpec(log, spec);
  }

  const diff: Record<string, BacktestDiff> = {};
  if (specs.length > 0) {
    const baselineName = specs[0].name;
    const baseline = perSpec[baselineName];
    for (let i = 1; i < specs.length; i++) {
      const name = specs[i].name;
      diff[name] = diffSignals(baseline, perSpec[name]);
    }
  }
  return { perSpec, diff };
}
