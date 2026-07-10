/**
 * `tflo-react/ops` — event-time stream operators (windows, keyed joins) and
 * the streaming technical-analysis catalog (SMA/EMA/RSI/Bollinger/MACD/cross).
 *
 * Opt-in: importing this entry pulls the `ops` wasm module (~120 KB gzip), kept
 * out of the lean main `tflo-react` entry. The module loads lazily — the
 * `useJoin` hook (and `useOpsReady`) trigger it; the synchronous facades
 * (`windowJoinKeyed`, `tumblingWindow`, `indicators.*`) require ops to be
 * initialized first, so gate component-render facade calls on `useOpsReady()`
 * (or `await initTfloOps()` outside React).
 */
export {
  windowJoinKeyed,
  tumblingWindow,
  type KeyedJoinConfig,
  type JoinedPair,
  type TumblingConfig,
  type TumblingWindowResult,
} from "../core/ops";

export { useJoin } from "../hooks/useJoin";
export { useOpsReady } from "../hooks/useOpsReady";

/** Streaming technical-analysis / detector facades (math only). */
export * as indicators from "../core/indicators";

/** Explicitly (pre)load the ops wasm module. Idempotent. */
export { initTfloOps } from "../core/wasmInit";
