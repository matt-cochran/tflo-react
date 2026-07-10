/**
 * tflo-react — temporal state for React, over the tflo WASM CEP engine.
 */

// Provider + scope
export { TfloProvider, TfloScope, useTfloContext, type TfloContextValue } from "./core/provider";

// Injected time source for the self-driving deadlines. Same clock stamps events
// and drives wake-ups, so they share one timeline. systemClock = live wall-clock;
// ManualClock = virtual time the consumer advances (tests / replay / scrubbing).
export { systemClock, ManualClock, type Clock } from "./core/clock";

// Core primitives
export { useEmit } from "./hooks/useEmit";
export { usePattern, type UsePatternOpts } from "./hooks/usePattern";
export { useSignal } from "./hooks/useSignal";
export { useSignalCallback } from "./hooks/useSignalCallback";

// Provenance — "why did this signal fire?" (opt-in via TfloProvider `trace`)
export { useExplain } from "./hooks/useExplain";
export {
  TraceStore,
  causesFrom,
  type CauseRef,
  type TraceNode,
} from "./core/provenance";

// Building blocks
export { useWindow, useCount, type WindowOpts, type WindowState } from "./hooks/useWindow";
export {
  useFold,
  type FoldReducer,
  type FoldContext,
  type FoldOpts,
} from "./hooks/useFold";
export { useRecorder, type Recorder, type RecorderOpts } from "./hooks/useRecorder";
export { useCombineLatest } from "./hooks/useCombineLatest";

// Backtest / what-if — replay one recorded event log against MULTIPLE rule specs
// and diff the results ("what-if I'd shipped rule B instead of rule A?"). Pure &
// deterministic: a pure CEP engine packages this latent superpower for free.
export {
  useBacktest,
  runBacktest,
  type BacktestEvent,
  type BacktestSpec,
  type BacktestDiff,
  type BacktestResult,
} from "./hooks/useBacktest";

// Shadow / canary rule rollout — run a CANDIDATE temporal spec alongside the
// ACTIVE one over the SAME live event stream, without acting on the candidate,
// and surface a live DIVERGENCE stream. Reuses the backtest parity/diff
// mechanism, but live — the safe way to canary a rule change.
export {
  useShadowSpec,
  type ShadowSpec,
  type ShadowDivergence,
  type ShadowState,
} from "./hooks/useShadowSpec";

// Derived state, not stored state — queryable current state per entity, folded
// from the event stream (raw + derived). Replaces hand-maintained status flags.
export {
  useProjection,
  guard,
  type Projection,
  type ProjectionOpts,
  type ProjectionState,
} from "./hooks/useProjection";

// Observable backpressure — dropped partial matches as reactive state (B3).
// RxJS drops silently under load; tflo makes the loss visible.
export { useDropMetrics } from "./hooks/useDropMetrics";
export { type DropMetrics } from "./core/runtimeRegistry";

// Pattern builder + types
export {
  Pattern,
  CompiledPattern,
  PatternRuntime,
  type Match,
  type MatchContext,
  type EmitOutput,
  type DerivedSignal,
  type DropReason,
} from "./core/pattern";

// Event-time ops (windows/joins) + indicators are an opt-in entry — they pull
// the heavier `ops` wasm. Import them from `tflo-react/ops`. CEL rules-as-data
// (`useCelRules`) and CEL-string patterns live in `tflo-react/cel`. Keeping
// them out of the root entry is what holds the main bundle at ~17 KB gzip.

// Shipped ergonomic hooks
export { useDebounced } from "./temporal/useDebounced";
export { useThrottled } from "./temporal/useThrottled";
export { useIdle } from "./temporal/useIdle";
export { useRateLimit } from "./temporal/useRateLimit";
export { useAsyncGuard } from "./temporal/useAsyncGuard";

// WASM init (advanced; the provider calls this for you). `initTfloOps` lives in
// the `tflo-react/ops` entry.
export { initTflo } from "./core/wasmInit";

// ── Typed public API (RECOMMENDED) ──────────────────────────────────────────
// `createTflo<E, S>()` returns fully-typed, bound hooks over the soft engine.
// The untyped hooks above remain the dynamic / CEL escape hatch.
export { createTflo, type TfloApi, type TypedUsePatternOpts } from "./typed/createTflo";
export {
  TypedPattern,
  type PayloadFor,
  type SignalEvent,
  type TypedMatch,
  type TypedMatchContext,
} from "./typed/pattern";
export type { TfloEvent, SignalMap, TypedSignal } from "./typed/types";
