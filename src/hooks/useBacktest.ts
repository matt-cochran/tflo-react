import { useMemo } from "react";
import { useTfloContext } from "../core/provider";
import {
  type BacktestEvent,
  type BacktestResult,
  type BacktestSpec,
  runBacktest,
} from "../core/backtest";

/**
 * Backtest / what-if: replay one recorded event `log` against MULTIPLE temporal
 * rule `specs` and diff the results — "what-if I'd shipped rule B instead of
 * rule A?". The first spec is the baseline; each other spec is diffed against it.
 *
 * Because the engine is pure (event-time only, no wall-clock), the replay is
 * fully deterministic: the same (log, specs) always yields the same signals and
 * the same diff. No live runtime is touched — each spec gets its own throwaway
 * runtime that is pushed the whole log, flushed, and freed. Pair with
 * {@link useRecorder} to backtest a real captured session against rule variants.
 *
 * Returns `undefined` until the WASM engine is `ready`. The result is memoized
 * on `log`/`specs` identity, so pass stable references (e.g. `useMemo`) to avoid
 * re-running the replay every render.
 */
export function useBacktest<E extends BacktestEvent = BacktestEvent>(
  log: E[],
  specs: BacktestSpec<E>[],
): BacktestResult | undefined {
  const { ready } = useTfloContext();
  return useMemo(() => {
    if (!ready) return undefined;
    return runBacktest(log, specs);
  }, [ready, log, specs]);
}

export {
  type BacktestEvent,
  type BacktestSpec,
  type BacktestDiff,
  type BacktestResult,
  runBacktest,
} from "../core/backtest";
