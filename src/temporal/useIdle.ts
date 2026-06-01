import { useEffect, useState } from "react";

/**
 * Returns `true` once `ms` have elapsed without `activitySignal` changing.
 * Pass any value that changes on activity (a counter, the last event, a key).
 * Replaces hand-rolled idle/“are you still there?” timers.
 */
export function useIdle(activitySignal: unknown, ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    const id = setTimeout(() => setIdle(true), ms);
    return () => clearTimeout(id);
  }, [activitySignal, ms]);
  return idle;
}
