import { type DependencyList, useEffect, useId, useSyncExternalStore } from "react";
import { useTfloContext } from "../core/provider";
import { type CompiledPattern, type DerivedSignal, Pattern } from "../core/pattern";

export interface UsePatternOpts<E> {
  /** Only route events of these `kind`s to this pattern (fan-out control). */
  kinds?: string[];
  /** Re-dispatch this pattern's emitted signals as events (layered CEP). */
  feedback?: boolean;
  /**
   * Track one isolated runtime per key — so a single `usePattern` correctly
   * follows many concurrent entities (e.g. `partitionBy: e => e.flowId`).
   * This closes the engine's cross-step field-correlation gap at the binding
   * layer: each entity gets its own partial-match state.
   */
  partitionBy?: (e: E) => unknown;
}

/**
 * Declare a temporal pattern; returns its latest emitted signal as reactive
 * state. The pattern is compiled and registered when `ready`/`deps` change and
 * freed on unmount/recompile (the registry owns the WASM handles).
 */
export function usePattern<E extends { ts: number } = { ts: number }>(
  name: string,
  build: (p: Pattern<E>) => CompiledPattern<E>,
  deps: DependencyList = [],
  opts: UsePatternOpts<E> = {},
): DerivedSignal | undefined {
  const { runtimes, signals, ready } = useTfloContext();
  const id = `${useId()}:${name}`;

  useEffect(() => {
    if (!ready) return;
    if (opts.partitionBy) {
      runtimes.registerPartitioned(
        id,
        name,
        () => build(new Pattern<E>(name)) as unknown as CompiledPattern<{ ts: number }>,
        opts.partitionBy as (e: { ts: number } & Record<string, unknown>) => unknown,
        { kinds: opts.kinds, feedback: opts.feedback },
      );
    } else {
      const compiled = build(new Pattern<E>(name));
      runtimes.register(id, compiled as unknown as CompiledPattern<{ ts: number }>, {
        kinds: opts.kinds,
        feedback: opts.feedback,
      });
    }
    return () => runtimes.deregister(id);
    // build/opts intentionally excluded — deps drive recompilation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id, ...deps]);

  return useSyncExternalStore(
    (cb) => signals.subscribe(name, cb),
    () => signals.get(name),
    () => undefined,
  );
}
