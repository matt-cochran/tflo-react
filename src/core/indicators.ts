/**
 * Thin typed facades over tflo's `ops` WASM surface — the streaming
 * technical-analysis / signal-processing catalog (SMA, EMA, RSI, Bollinger,
 * MACD, threshold crossings). These run the same Rust engine used server-side.
 * Batch (whole-array) helpers; for live streams compose them with `useWindow`
 * or feed via `useEmit`. Math-only: CEL rule evaluation lives in
 * `@tflo/react/cel` (it needs the heavier CEL-enabled wasm).
 *
 * Reachable via the `@tflo/react/ops` entry, which lazily loads the ops wasm.
 */
import {
  compute_sma,
  compute_ema,
  compute_rsi,
  compute_bollinger,
  compute_macd,
  detect_cross,
} from "../wasm/ops/tflo_wasm.js";

export interface Tick {
  ts: number;
  value: number;
}

const call = <T>(fn: (a: string, b: string) => string, input: unknown, config: unknown): T =>
  JSON.parse(fn(JSON.stringify(input), JSON.stringify(config))) as T;

export const sma = (ticks: Tick[], period: number): (number | null)[] =>
  call(compute_sma, ticks, { period });

export const ema = (ticks: Tick[], period: number): (number | null)[] =>
  call(compute_ema, ticks, { period });

export const rsi = (ticks: Tick[], period: number): (number | null)[] =>
  call(compute_rsi, ticks, { period });

export const bollinger = (
  ticks: Tick[],
  period: number,
  multiplier = 2,
): ({ middle: number; upper: number; lower: number } | null)[] =>
  call(compute_bollinger, ticks, { period, multiplier });

export const macd = (
  ticks: Tick[],
  fast: number,
  slow: number,
  signal: number,
): { macd: number; signal: number; histogram: number }[] =>
  call(compute_macd, ticks, { fast, slow, signal });

export const cross = (
  ticks: Tick[],
  threshold: number,
  direction: "above" | "below" | "both" = "both",
): { value: number; direction: "above" | "below" }[] =>
  call(detect_cross, ticks, { threshold, direction });
