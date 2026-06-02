import { useCallback } from "react";
import { useTfloContext } from "../core/provider";

/**
 * Returns a stable `dispatch` that pushes an event into the bus.
 *
 * The constraint is `{ kind?: string; ts?: number }` (NOT
 * `Record<string, unknown> & ...`): a strict discriminated union member like
 * `{ kind: "click"; ts: number }` IS assignable to it, but is NOT assignable to
 * `Record<string, unknown>` (an interface/union has no implicit string index
 * signature). So `useEmit<MyUnion>()` accepts a clean union without the consumer
 * having to write `extends Record<string, unknown>`. The bus stores arbitrary
 * event objects, so this only relaxes the call-site shape, not what's stored.
 */
export function useEmit<E extends { kind?: string; ts?: number } = { kind?: string; ts?: number }>(): (
  event: E,
) => void {
  const { bus } = useTfloContext();
  return useCallback(
    (event: E) => bus.dispatch(event as Record<string, unknown> & { kind?: string; ts?: number }),
    [bus],
  );
}
