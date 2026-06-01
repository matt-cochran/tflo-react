/**
 * Typed facades over the `tflo-wasm` JSON bridge (the `ops` module).
 * These surface tflo's event-time stream operators to TypeScript with real
 * types — the heavy lifting (event-time semantics, out-of-order tolerance)
 * happens in the Rust engine, byte-identical to the server.
 */
import {
  window_join_keyed,
  tumbling_window,
} from "../wasm/ops/tflo_wasm.js";

export interface KeyedJoinConfig {
  /** Field name to equi-join on (e.g. "orderId"). */
  key: string;
  /** Field name holding the event-time timestamp (default "ts"). */
  ts?: string;
  /** Forward window in ms: right.ts ∈ [left.ts, left.ts + window]. */
  window: number;
}

export interface JoinedPair<L, R> {
  left: L;
  right: R;
  deltaMs: number;
}

/**
 * Keyed, forward-windowed event-time join. Correct regardless of arrival
 * order. Returns each (left, right) pair whose `key` fields match and whose
 * `right.ts ∈ [left.ts, left.ts + window]`.
 */
export function windowJoinKeyed<L = Record<string, unknown>, R = Record<string, unknown>>(
  left: L[],
  right: R[],
  config: KeyedJoinConfig,
): JoinedPair<L, R>[] {
  const out = window_join_keyed(
    JSON.stringify(left),
    JSON.stringify(right),
    JSON.stringify(config),
  );
  return JSON.parse(out) as JoinedPair<L, R>[];
}

export interface TumblingConfig {
  /** Tumbling window width in event-time ms. */
  windowMs: number;
  /** Bounded out-of-orderness: late events within this many ms still land in
   *  their event-time window (default 0 → late events dropped). */
  allowedLatenessMs?: number;
}

export interface TumblingWindowResult {
  windowStart: number;
  windowEnd: number;
  count: number;
  sum: number;
}

/**
 * Event-time tumbling window aggregation with bounded out-of-orderness.
 * Events may arrive in any order; bucketing is by event-time.
 */
export function tumblingWindow(
  events: { ts: number; value: number }[],
  config: TumblingConfig,
): TumblingWindowResult[] {
  const out = tumbling_window(JSON.stringify(events), JSON.stringify(config));
  return JSON.parse(out) as TumblingWindowResult[];
}
