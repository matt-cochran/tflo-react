import { useMemo } from "react";
import { type JoinedPair, type KeyedJoinConfig, windowJoinKeyed } from "../core/ops";
import { useOpsReady } from "./useOpsReady";

/**
 * Keyed, forward-windowed event-time join of two streams, via the tflo engine.
 * Returns matched pairs (correct regardless of arrival order). Lazily loads the
 * `ops` wasm on mount; empty until it is ready.
 */
export function useJoin<L = Record<string, unknown>, R = Record<string, unknown>>(
  left: L[],
  right: R[],
  config: KeyedJoinConfig,
): JoinedPair<L, R>[] {
  const ready = useOpsReady();
  return useMemo(
    () => (ready ? windowJoinKeyed<L, R>(left, right, config) : []),
    [ready, left, right, config.key, config.ts, config.window],
  );
}
