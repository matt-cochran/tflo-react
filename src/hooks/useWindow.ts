import { useEffect, useRef, useState } from "react";
import { useTfloContext } from "../core/provider";

export interface WindowOpts {
  /** Rolling window width in event-time ms. */
  ms: number;
  /** Hard cap on retained events (memory bound). */
  maxEvents?: number;
}

export interface WindowState<E> {
  events: E[];
  count: number;
}

/**
 * Sliding-window aggregate building block — a bounded, event-time ring buffer
 * over events of a given `kind`. Complements the WASM sequence engine (which
 * does not do counts/aggregates). The atom under rate-limit, coalescing, and
 * presence-density recipes.
 */
export function useWindow<E extends { ts: number; kind?: string } = { ts: number; kind?: string }>(
  kind: string,
  opts: WindowOpts,
): WindowState<E> {
  const { bus } = useTfloContext();
  const [state, setState] = useState<WindowState<E>>({ events: [], count: 0 });
  const buf = useRef<E[]>([]);

  useEffect(() => {
    buf.current = [];
    setState({ events: [], count: 0 });
    return bus.tap((ev) => {
      if (kind && ev.kind !== kind) return;
      const b = buf.current;
      b.push(ev as E);
      const latest = ev.ts;
      while (b.length && latest - b[0].ts > opts.ms) b.shift();
      if (opts.maxEvents && b.length > opts.maxEvents) b.splice(0, b.length - opts.maxEvents);
      setState({ events: [...b], count: b.length });
    });
  }, [bus, kind, opts.ms, opts.maxEvents]);

  return state;
}

/** Rolling count of events of `kind` within `opts.ms` of event-time. */
export function useCount(kind: string, opts: WindowOpts): number {
  return useWindow(kind, opts).count;
}
