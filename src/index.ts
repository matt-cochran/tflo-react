/**
 * @tflo/react — temporal state for React, over the tflo WASM CEP engine.
 */

// Provider + scope
export { TfloProvider, TfloScope, useTfloContext, type TfloContextValue } from "./core/provider";

// Core primitives
export { useEmit } from "./hooks/useEmit";
export { usePattern, type UsePatternOpts } from "./hooks/usePattern";
export { useSignal } from "./hooks/useSignal";
export { useSignalCallback } from "./hooks/useSignalCallback";

// Building blocks
export { useWindow, useCount, type WindowOpts, type WindowState } from "./hooks/useWindow";
export { useJoin } from "./hooks/useJoin";
export { useRecorder, type Recorder, type RecorderOpts } from "./hooks/useRecorder";

// Pattern builder + types
export {
  Pattern,
  CompiledPattern,
  PatternRuntime,
  type Match,
  type MatchContext,
  type EmitOutput,
  type DerivedSignal,
} from "./core/pattern";

// Engine facades (event-time ops)
export {
  windowJoinKeyed,
  tumblingWindow,
  type KeyedJoinConfig,
  type JoinedPair,
  type TumblingConfig,
  type TumblingWindowResult,
} from "./core/ops";

// CEL rules-as-data (server-pushable behavior; cross-tier parity stepping stone)
export { useCelRules } from "./hooks/useCelRules";

// Shipped ergonomic hooks
export { useDebounced } from "./temporal/useDebounced";
export { useThrottled } from "./temporal/useThrottled";
export { useIdle } from "./temporal/useIdle";
export { useRateLimit } from "./temporal/useRateLimit";
export { useAsyncGuard } from "./temporal/useAsyncGuard";

// Streaming indicators / detectors / CEL (the rest of tflo's ops surface)
export * as indicators from "./core/indicators";

// WASM init (advanced; the provider calls this for you)
export { initTflo } from "./core/wasmInit";
