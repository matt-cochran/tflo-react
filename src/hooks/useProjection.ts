import { useEffect, useMemo, useRef, useState } from "react";
import { useTfloContext } from "../core/provider";

/** Options for {@link useProjection}. */
export interface ProjectionOpts {
  /**
   * Which event kinds feed the projection. A string, an array, or omitted for
   * *all* events (including re-entered derived signals, which arrive as
   * `kind:"signal"`). This is how a projection folds verdicts/corrections as well
   * as raw events.
   */
  kind?: string | string[];
  /**
   * Hard cap on the number of keyed states retained (memory bound). When
   * exceeded, the least-recently-updated key is evicted. Omit for unbounded.
   */
  maxKeys?: number;
}

/** A queryable keyed read-model: the current derived state per entity. */
export interface Projection<K, S> {
  /** Current derived state for `key`, or `undefined` if nothing folded yet. */
  get(key: K): S | undefined;
  /** All `[key, state]` pairs — for dashboards / "list everything". */
  entries(): [K, S][];
  /** Number of keyed states held. */
  readonly size: number;
}

/**
 * **Derived state, not stored state.** Folds the event stream into a queryable
 * *current state per entity* — the read-model half of the derived-events stack.
 * Instead of a mutable `status` flag kept in sync by hand, you declare a reducer
 * and read the derived status: `status = fold(history)`.
 *
 * The fold is **incremental** — each event is applied to the prior state for its
 * key (`reducer(prev, event)`), not recomputed from scratch — so it is O(1) per
 * event with no retained event log (unlike `useFold`). It folds **raw events and
 * re-entered derived signals alike** (verdicts/corrections arrive as
 * `kind:"signal"`), so a correction is just a superseding event the reducer
 * applies (last-writer-wins by arrival; the engine and demos feed events in
 * event-time order). Out-of-order *reordering* is the deferred watermark concern,
 * not handled here.
 *
 * Returns a {@link Projection} you can `get(key)` / `entries()`; the object's
 * identity changes when any key updates, so reading components re-render.
 */
export function useProjection<E extends { ts?: number; kind?: string }, K, S>(
  key: (event: E) => K,
  reducer: (state: S | undefined, event: E) => S,
  opts: ProjectionOpts = {},
): Projection<K, S> {
  const { bus } = useTfloContext();
  const [version, setVersion] = useState(0);

  // Latest closures so the bus tap (registered once) always folds with the
  // current key/reducer without re-subscribing each render.
  const keyRef = useRef(key);
  keyRef.current = key;
  const reducerRef = useRef(reducer);
  reducerRef.current = reducer;

  // The materialized read-model. Map preserves insertion order, which gives a
  // cheap LRU-ish eviction (re-insert on update keeps a touched key "fresh").
  const store = useRef(new Map<K, S>());

  const kinds = useMemo<Set<string> | null>(() => {
    if (opts.kind === undefined) return null;
    return new Set(Array.isArray(opts.kind) ? opts.kind : [opts.kind]);
  }, [opts.kind]);
  const maxKeys = opts.maxKeys;

  useEffect(() => {
    store.current.clear();
    setVersion((v) => v + 1);

    return bus.tap((rawEv) => {
      const k = rawEv.kind;
      if (kinds && (typeof k !== "string" || !kinds.has(k))) return;
      const ev = rawEv as unknown as E;
      const id = keyRef.current(ev);
      if (id === undefined || id === null) return;

      const m = store.current;
      const next = reducerRef.current(m.get(id), ev);
      m.delete(id); // re-insert to mark most-recently-updated (eviction order)
      m.set(id, next);

      if (maxKeys && m.size > maxKeys) {
        const oldest = m.keys().next().value as K | undefined;
        if (oldest !== undefined) m.delete(oldest);
      }
      setVersion((v) => v + 1);
    });
  }, [bus, kinds, maxKeys]);

  // A facade whose identity changes per update (via `version`) so consumers
  // re-render; its methods read the live store.
  return useMemo<Projection<K, S>>(
    () => ({
      get: (k: K) => store.current.get(k),
      entries: () => [...store.current.entries()],
      get size() {
        return store.current.size;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}
