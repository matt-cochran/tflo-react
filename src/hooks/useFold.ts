import { useEffect, useRef, useState } from "react";
import { useTfloContext } from "../core/provider";

/** Event-time context handed to the fold reducer for each event. */
export interface FoldContext {
  /** Event-time of the current event (ms), per the configured extractor. */
  ts: number;
}

/** A pure fold step: `(acc, event, ctx) -> acc`. Must be deterministic. */
export type FoldReducer<E, A> = (acc: A, event: E, ctx: FoldContext) => A;

export interface FoldOpts<E> {
  /**
   * Event-time extractor (ms). Defaults to `e.ts`. The fold is always applied
   * in ascending event-time order, so this is what makes the result
   * deterministic and replayable regardless of wall-clock arrival order.
   */
  timestamp?: (e: E) => number;
  /** Hard cap on retained events (memory bound); oldest event-time evicted first. */
  maxEvents?: number;
}

/**
 * Event-time scan/fold — the first-class form of the engine's stateful-step
 * (scan) semantics (`StatefulTracker`: fold each input value + its timestamp
 * into running state). Folds an accumulator over the stream of events of a
 * given `kind`, **in event-time order**: events arriving out of order in
 * wall-clock are inserted at their event-time position and the fold is
 * recomputed from `initial`, so the same event set always yields the same
 * accumulator (deterministic, replayable). This mirrors `useWindow`'s
 * bus-driven, event-time, `kind`-filtered ingestion and the
 * "correct-regardless-of-arrival-order" convention of the event-time ops
 * (`useJoin`/`tumblingWindow`).
 *
 * Returns `[acc, reset]` — the current accumulator and a function that clears
 * the retained events back to `initial`.
 *
 * Note: like RxJS `scan`/`fold` but with the event-time semantics RxJS lacks —
 * the fold order is the events' event-time, not their subscription order.
 */
export function useFold<E extends { ts?: number; kind?: string } = { ts: number; kind?: string }, A = unknown>(
  kind: string,
  reducer: FoldReducer<E, A>,
  initial: A,
  opts: FoldOpts<E> = {},
): [A, () => void] {
  const { bus } = useTfloContext();
  const [acc, setAcc] = useState<A>(initial);

  // Latest closures, so the bus tap (registered once) always folds with the
  // current reducer/initial without re-subscribing on every render.
  const reducerRef = useRef(reducer);
  reducerRef.current = reducer;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const tsRef = useRef(opts.timestamp);
  tsRef.current = opts.timestamp;

  // Retained events of `kind`, kept sorted by event-time (stable on ties).
  const buf = useRef<Array<{ ts: number; ev: E }>>([]);
  const maxEvents = opts.maxEvents;

  useEffect(() => {
    buf.current = [];
    setAcc(initialRef.current);

    const tsOf = (ev: E): number =>
      tsRef.current ? tsRef.current(ev) : ((ev as { ts?: number }).ts ?? 0);

    const recompute = (): void => {
      let a = initialRef.current;
      const r = reducerRef.current;
      for (const { ts, ev } of buf.current) a = r(a, ev, { ts });
      setAcc(a);
    };

    return bus.tap((rawEv) => {
      if (kind && rawEv.kind !== kind) return;
      const ev = rawEv as unknown as E;
      const ts = tsOf(ev);

      // Insert at the event-time position (ascending; ties keep arrival order
      // via the `>` comparison — a later-arriving equal-ts event sorts after).
      const b = buf.current;
      let i = b.length;
      while (i > 0 && b[i - 1].ts > ts) i--;
      b.splice(i, 0, { ts, ev });

      if (maxEvents && b.length > maxEvents) b.splice(0, b.length - maxEvents);

      recompute();
    });
  }, [bus, kind, maxEvents]);

  const reset = useRef(() => {
    buf.current = [];
    setAcc(initialRef.current);
  }).current;

  return [acc, reset];
}
