import { type DependencyList, useEffect, useId, useRef, useSyncExternalStore } from "react";
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
 *
 * **Race-proof registration:** the pattern registers SYNCHRONOUSLY during render
 * (the first time the engine is `ready`), not in a passive effect. This closes
 * the window where a pattern mounted *after* the engine is ready (bus already
 * open) could miss an event dispatched in the same commit — e.g. from a sibling
 * layout effect, which runs before passive effects would have registered it. The
 * registry is ref-counted and id-keyed, so StrictMode's double render/mount can't
 * double-register; the effect reconciles deps-driven recompiles and frees the
 * handle on unmount. (Pre-`ready` dispatches are still caught by the bus's
 * buffer-until-ready net.)
 */
export function usePattern<E extends { ts: number } = { ts: number }>(
  name: string,
  build: (p: Pattern<E>) => CompiledPattern<E>,
  deps: DependencyList = [],
  opts: UsePatternOpts<E> = {},
): DerivedSignal | undefined {
  const { runtimes, signals, ready } = useTfloContext();
  const id = `${useId()}:${name}`;
  const registeredRef = useRef(false);

  // Idempotent registration shared by the render-phase (race-proof) path and the
  // effect (covers a `ready` flip after render, and re-register after a
  // deps-change cleanup). The `registeredRef` guard + the registry's id-keyed
  // ref-counting keep it exactly-once per commit.
  const doRegister = (): void => {
    if (registeredRef.current) return;
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
    registeredRef.current = true;
  };

  // Synchronous, race-proof registration. Registering during render touches the
  // external registry, but it is ref-counted/id-keyed and reconciled by the
  // effect cleanup below, so a same-commit dispatch can never beat us to it.
  if (ready) doRegister();

  useEffect(() => {
    if (!ready) return;
    doRegister(); // ready flipped post-render, or re-register after deps cleanup
    return () => {
      runtimes.deregister(id);
      registeredRef.current = false;
    };
    // build/opts intentionally excluded — deps drive recompilation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id, ...deps]);

  return useSyncExternalStore(
    (cb) => signals.subscribe(name, cb),
    () => signals.get(name),
    () => undefined,
  );
}
