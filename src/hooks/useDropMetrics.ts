import { useCallback, useRef, useSyncExternalStore } from "react";
import { useTfloContext } from "../core/provider";
import type { DropMetrics } from "../core/runtimeRegistry";

const ZERO: DropMetrics = { total: 0, maxInFlight: 0, deadline: 0, late: 0 };

/**
 * Observable backpressure (B3): the count of partial matches the engine has
 * dropped, broken down by reason, as reactive React state.
 *
 * RxJS drops silently when a consumer can't keep up; tflo's bounded CEP engine
 * makes that loss VISIBLE. Every runtime owned by the provider funnels its drops
 * into one aggregate tally — this hook subscribes to it and re-renders the
 * component when a drop happens, so an app can display/alert on backpressure
 * instead of losing matches in the dark.
 *
 * Returns `{ total, maxInFlight, deadline, late }` — monotonic lifetime counts
 * where `total === maxInFlight + deadline + late`:
 * - `maxInFlight` — partials evicted because the bounded in-flight set overflowed.
 * - `deadline`    — partials whose positive-step `within(...)` window lapsed.
 * - `late`        — events dropped behind a reorder buffer's event-time frontier.
 *
 * Counts are registry-wide (all patterns in scope), mirroring how the registry
 * owns the WASM runtimes rather than any single `usePattern` call.
 */
export function useDropMetrics(): DropMetrics {
  const { runtimes } = useTfloContext();

  // `dropMetrics()` returns a fresh object each call; cache it so the
  // `useSyncExternalStore` snapshot is referentially stable until counts change,
  // avoiding an infinite re-render loop.
  const cache = useRef<DropMetrics>(ZERO);

  const subscribe = useCallback(
    (onChange: () => void) => runtimes.subscribeDrops(onChange),
    [runtimes],
  );

  const getSnapshot = useCallback((): DropMetrics => {
    const next = runtimes.dropMetrics();
    const prev = cache.current;
    if (
      next.total === prev.total &&
      next.maxInFlight === prev.maxInFlight &&
      next.deadline === prev.deadline &&
      next.late === prev.late
    ) {
      return prev;
    }
    cache.current = next;
    return next;
  }, [runtimes]);

  // Stable SSR snapshot: zeroed and identical on server + first client paint.
  const getServerSnapshot = useCallback((): DropMetrics => ZERO, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
