/**
 * `createTflo<E, S>()` — the fully-typed public facade.
 *
 * Returns bound, generically-typed wrappers around the untyped runtime hooks.
 * `E` is a discriminated-union event type; `S` is a `{ signalName: payload }`
 * map. Every hook is re-typed in terms of `E`/`S`; the runtime is unchanged
 * (the wrappers cast at the boundary). The untyped hooks remain importable from
 * `tflo-react` for dynamic / CEL use.
 *
 * This is the RECOMMENDED entry point. Call it ONCE per app (module scope) with
 * your schema, then use the returned `Provider` + hooks everywhere.
 */
import type { DependencyList } from "react";
import * as core from "../index";
import type { CompiledPattern } from "../core/pattern";
import { TypedPattern } from "./pattern";
import type { TfloEvent, SignalMap, TypedSignal } from "./types";

/** Options for the typed `usePattern`, with `partitionBy` keyed to `E`. */
export interface TypedUsePatternOpts<E extends TfloEvent> {
  kinds?: Array<E["kind"]>;
  feedback?: boolean;
  partitionBy?: (e: E) => unknown;
  /** Event-time reorder buffer — release out-of-order events in event-time order
   * within `maxLateness` ms (later ones drop as `"late"`). See `UsePatternOpts`. */
  reorder?: { maxLateness: number };
}

export interface TfloApi<E extends TfloEvent, S extends SignalMap> {
  Provider: typeof core.TfloProvider;
  Scope: typeof core.TfloScope;
  useTfloContext: typeof core.useTfloContext;
  useEmit: () => (event: E) => void;
  usePattern: <K extends keyof S & string>(
    name: K,
    build: (p: TypedPattern<E, S, K>) => CompiledPattern<E>,
    deps?: DependencyList,
    opts?: TypedUsePatternOpts<E>,
  ) => TypedSignal<S[K]> | undefined;
  useSignal: <K extends keyof S & string>(name: K) => TypedSignal<S[K]> | undefined;
  useSignalCallback: <K extends keyof S & string>(
    name: K,
    fn: (s: TypedSignal<S[K]>) => void,
  ) => void;
  useWindow: (kind: E["kind"], opts: core.WindowOpts) => core.WindowState<E>;
  useCount: (kind: E["kind"], opts: core.WindowOpts) => number;
  useRecorder: (opts?: core.RecorderOpts) => core.Recorder;
  /** Derived state per entity, folded from events (raw + derived). Replaces a
   * hand-maintained status flag with `status = fold(history)`. */
  useProjection: <K, St>(
    key: (e: E) => K,
    reducer: (state: St | undefined, e: E) => St,
    opts?: core.ProjectionOpts,
  ) => core.Projection<K, St>;
  // Note: keyed event-time joins (`useJoin`) and the indicator catalog live in
  // the opt-in `tflo-react/ops` entry, so the typed root API stays lean.
}

export function createTflo<E extends TfloEvent, S extends SignalMap>(): TfloApi<E, S> {
  return {
    Provider: core.TfloProvider,
    Scope: core.TfloScope,
    useTfloContext: core.useTfloContext,

    useEmit: () => core.useEmit() as (e: E) => void,

    usePattern: <K extends keyof S & string>(
      name: K,
      build: (p: TypedPattern<E, S, K>) => CompiledPattern<E>,
      deps: DependencyList = [],
      opts?: TypedUsePatternOpts<E>,
    ): TypedSignal<S[K]> | undefined =>
      core.usePattern<E>(
        name,
        (raw) =>
          build(
            new TypedPattern<E, S, K>(raw, name),
          ) as unknown as CompiledPattern<E>,
        deps,
        opts as core.UsePatternOpts<E> | undefined,
      ) as TypedSignal<S[K]> | undefined,

    useSignal: <K extends keyof S & string>(name: K): TypedSignal<S[K]> | undefined =>
      core.useSignal(name) as TypedSignal<S[K]> | undefined,

    useSignalCallback: <K extends keyof S & string>(
      name: K,
      fn: (s: TypedSignal<S[K]>) => void,
    ): void => core.useSignalCallback(name, fn as (s: core.DerivedSignal) => void),

    useWindow: (kind: E["kind"], opts: core.WindowOpts): core.WindowState<E> =>
      core.useWindow<E>(kind, opts),

    useCount: (kind: E["kind"], opts: core.WindowOpts): number => core.useCount(kind, opts),

    useRecorder: (opts?: core.RecorderOpts): core.Recorder => core.useRecorder(opts),

    useProjection: <K, St>(
      key: (e: E) => K,
      reducer: (state: St | undefined, e: E) => St,
      opts?: core.ProjectionOpts,
    ): core.Projection<K, St> => core.useProjection<E, K, St>(key, reducer, opts),
  };
}
