import { useEffect, useRef, useState } from "react";
import { useTfloContext } from "../core/provider";
import { type BacktestEvent, diffSignals } from "../core/backtest";
import { type CompiledPattern, type DerivedSignal, Pattern, PatternRuntime } from "../core/pattern";

/**
 * One temporal rule variant to run in shadow mode. Same shape as a backtest
 * spec: a stable `name` plus a `build` that constructs the compiled pattern from
 * a fresh `Pattern` builder — so an existing `usePattern` definition can be
 * reused verbatim as either the active or the candidate.
 */
export interface ShadowSpec<E extends BacktestEvent = BacktestEvent> {
  /** Stable identifier for this variant; appears in divergence diagnostics. */
  name: string;
  /** Construct the compiled pattern for this variant. */
  build: (p: Pattern<E>) => CompiledPattern<E>;
  /**
   * Optional event-time reorder buffer lateness (ms), mirroring `usePattern`'s
   * `reorder.maxLateness`. Omit for in-order delivery.
   */
  maxLateness?: number;
}

/**
 * A signal present on exactly one side of the shadow comparison — i.e. emitted
 * by the active OR the candidate, but not both. `side` says which runtime
 * produced it; the active side's signals are the ones a consumer would act on,
 * the candidate's are observed only.
 */
export interface ShadowDivergence {
  /** Which runtime emitted this otherwise-unmatched signal. */
  side: "active" | "candidate";
  /** The diverging signal itself. */
  signal: DerivedSignal;
}

export interface ShadowState {
  /** Every signal the ACTIVE spec has emitted, in emission order. */
  activeSignals: DerivedSignal[];
  /** Every signal the CANDIDATE spec has emitted, in emission order. */
  candidateSignals: DerivedSignal[];
  /**
   * Live divergence stream: signals emitted by exactly one side (keyed by
   * name + event-time + id-ish payload fields, the same key the backtest diff
   * uses). Active-only signals are tagged `side:"active"`, candidate-only
   * `side:"candidate"`. Empty ⇒ the two specs agree so far.
   */
  divergences: ShadowDivergence[];
}

const EMPTY: ShadowState = { activeSignals: [], candidateSignals: [], divergences: [] };

/**
 * Shadow / canary rule rollout — run a CANDIDATE temporal spec alongside the
 * ACTIVE one over the SAME live event stream, WITHOUT acting on the candidate's
 * output, and surface a live DIVERGENCE stream. This is how you canary a rule
 * change safely: the active side is the one a consumer acts on; the candidate is
 * observed only, so a regression shows up as a divergence before it ships.
 *
 * It reuses the exact parity/diff mechanism as {@link useBacktest}, but live:
 * both runtimes are pushed every event off the bus as it arrives, and
 * {@link diffSignals} computes which signals exactly one side emitted. Because
 * the engine is pure (event-time only, no wall-clock), feeding the same events
 * to both runtimes is the only thing that determines the divergence — the
 * comparison is deterministic.
 *
 * Returns the empty state until the engine is `ready`. The runtimes are rebuilt
 * (and the accumulated state reset) when the engine becomes ready or either
 * spec's `name`/`maxLateness` changes; `build` is read once per (re)build, so
 * pass it inline freely.
 */
export function useShadowSpec<E extends BacktestEvent = BacktestEvent>(
  active: ShadowSpec<E>,
  candidate: ShadowSpec<E>,
): ShadowState {
  const { bus, ready } = useTfloContext();
  const [state, setState] = useState<ShadowState>(EMPTY);

  // Accumulated emissions per side; recomputed into `divergences` on every push.
  const activeOut = useRef<DerivedSignal[]>([]);
  const candidateOut = useRef<DerivedSignal[]>([]);

  useEffect(() => {
    if (!ready) return;

    const activeRt = new PatternRuntime<E>(active.build(new Pattern<E>(active.name)), active.maxLateness);
    const candidateRt = new PatternRuntime<E>(
      candidate.build(new Pattern<E>(candidate.name)),
      candidate.maxLateness,
    );
    activeOut.current = [];
    candidateOut.current = [];
    setState(EMPTY);

    const recompute = (): void => {
      const a = activeOut.current;
      const c = candidateOut.current;
      // diffSignals(active, candidate): `removed` = active-only, `added` =
      // candidate-only. Each unmatched signal is one live divergence.
      const { added, removed } = diffSignals(a, c);
      const divergences: ShadowDivergence[] = [
        ...removed.map((signal) => ({ side: "active" as const, signal })),
        ...added.map((signal) => ({ side: "candidate" as const, signal })),
      ];
      setState({ activeSignals: [...a], candidateSignals: [...c], divergences });
    };

    const untap = bus.tap((ev) => {
      // Skip feedback re-entries (mirrors useRecorder): only raw events drive the
      // shadow comparison, so a fed-back signal can't double-count.
      if (ev.kind === "signal") return;
      const e = ev as unknown as E;
      let changed = false;
      for (const s of activeRt.push(e)) {
        activeOut.current.push(s);
        changed = true;
      }
      for (const s of candidateRt.push(e)) {
        candidateOut.current.push(s);
        changed = true;
      }
      if (changed) recompute();
    });

    return () => {
      untap();
      activeRt.destroy();
      candidateRt.destroy();
    };
    // `build` intentionally excluded — name/maxLateness drive rebuilds, matching
    // the deps discipline of usePattern/useBacktest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus, ready, active.name, active.maxLateness, candidate.name, candidate.maxLateness]);

  return state;
}
