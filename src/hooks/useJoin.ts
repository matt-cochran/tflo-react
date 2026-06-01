import { useMemo } from "react";
import { useTfloContext } from "../core/provider";
import { type JoinedPair, type KeyedJoinConfig, windowJoinKeyed } from "../core/ops";

/**
 * Keyed, forward-windowed event-time join of two streams, via the tflo engine.
 * Returns matched pairs (correct regardless of arrival order). Empty until the
 * WASM engine is ready.
 */
export function useJoin<L = Record<string, unknown>, R = Record<string, unknown>>(
  left: L[],
  right: R[],
  config: KeyedJoinConfig,
): JoinedPair<L, R>[] {
  const { ready } = useTfloContext();
  return useMemo(
    () => (ready ? windowJoinKeyed<L, R>(left, right, config) : []),
    [ready, left, right, config.key, config.ts, config.window],
  );
}
