import { useCallback } from "react";
import { useTfloContext } from "../core/provider";

/** Returns a stable `dispatch` that pushes an event into the bus. */
export function useEmit<
  E extends Record<string, unknown> & { kind?: string; ts?: number } = Record<string, unknown> & {
    kind?: string;
    ts?: number;
  },
>(): (event: E) => void {
  const { bus } = useTfloContext();
  return useCallback((event: E) => bus.dispatch(event), [bus]);
}
