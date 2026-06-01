/**
 * `TypedPattern` — a strict, generic facade over the soft runtime `Pattern`.
 *
 * Same fluent shape as `Pattern`, but:
 *  - `.when/.then/.notThen` predicates receive the discriminated event union `E`
 *    (so `e.kind === "..."` narrows the event's fields);
 *  - `.then/.notThen` also receive a typed `MatchContext<E>`;
 *  - `.emit(fn)` takes a closure returning ONLY the payload, which must satisfy
 *    `S[K]` (the payload type for this pattern's signal name `K`). The wrapper
 *    injects `{ name, ts, payload }` so the user never hand-builds the envelope.
 *
 * The engine stays soft: every closure is cast at the boundary
 * (`(e: unknown) => pred(e as E)`). No WASM/runtime change.
 *
 * The type parameter `K` carries the signal name so `.emit`'s payload is pinned
 * to `S[K]`. The factory (`createTflo`) supplies `K` from the `usePattern(name)`
 * literal; standalone construction defaults `K` to `keyof S`.
 */
import { Pattern, type CompiledPattern, type Match, type MatchContext } from "../core/pattern";
import type { TfloEvent, SignalMap } from "./types";

/** The payload type a `.emit` closure must return for signal `K` in map `S`. */
export type PayloadFor<S extends SignalMap, K extends keyof S> = S[K];

/**
 * The shape a re-entered signal takes when it flows back through the bus as an
 * event (the `{ kind:"signal", name, ts, payload }` feedback contract). A
 * `whenSignal/thenSignal(name)` step captures THIS shape, with `name` pinned to
 * the literal `N` and `payload` typed to `S[N]`.
 */
export interface SignalEvent<S extends SignalMap, N extends keyof S> {
  kind: "signal";
  name: N;
  ts: number;
  payload: S[N];
}

/**
 * `TypedPattern<E, S, K, Captured>`:
 *  - `E`        — the discriminated user-event union (`.when/.then/...`);
 *  - `S`        — the `{ signalName: payload }` map;
 *  - `K`        — this pattern's OWN signal name (pins `.emit`'s payload to `S[K]`);
 *  - `Captured` — the union of event shapes the `.emit` `Match` can observe. Starts
 *                 at `E`; each `whenSignal/thenSignal(name)` widens it with the
 *                 corresponding `SignalEvent` so `m.first()/.last()/.all()/.at()`
 *                 see the typed re-entered signal (with `name: N` + `payload: S[N]`).
 *
 * TRADEOFF (Match typing): `Captured` is the *union* of every step's shape, not a
 * per-position tuple. So `m.first()` is typed as `Captured` (a union), and reading
 * `payload` requires narrowing on `kind`/`name` (`if (e.kind === "signal" && e.name === "rage") e.payload`).
 * This is the same ergonomic as the existing event steps (where `m.first()` is the
 * `E` union and you narrow on `kind`). The NON-NEGOTIABLE win — `name` checked
 * against `keyof S`, autocompleted, typo-safe — is fully delivered; the captured
 * signal payload is reachable via that narrow. Full heterogeneous per-step tuple
 * typing of `Match` was judged too costly for the value and is intentionally not done.
 */
export class TypedPattern<
  E extends TfloEvent,
  S extends SignalMap,
  K extends keyof S = keyof S,
  Captured = E,
> {
  /**
   * @param inner the underlying soft `Pattern`
   * @param name  the signal name this pattern emits (also `K` at the type level)
   */
  constructor(
    // The soft runtime Pattern. We accept the loosest instantiation: closures
    // are cast at the boundary, so the inner generic is irrelevant here.
    private inner: Pattern,
    private readonly name: K & string,
  ) {}

  timestamp(fn: (e: E) => number): this {
    this.inner = this.inner.timestamp((e) => fn(e as E));
    return this;
  }

  when(pred: (e: E) => boolean): this {
    this.inner = this.inner.when((e) => pred(e as E));
    return this;
  }

  then(pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.then((e, c) => pred(e as E, c as MatchContext<E>));
    return this;
  }

  thenNamed(stepName: string, pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.thenNamed(stepName, (e, c) => pred(e as E, c as MatchContext<E>));
    return this;
  }

  notThen(pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.notThen((e, c) => pred(e as E, c as MatchContext<E>));
    return this;
  }

  notThenNamed(stepName: string, pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.notThenNamed(stepName, (e, c) => pred(e as E, c as MatchContext<E>));
    return this;
  }

  within(ms: number): this {
    this.inner = this.inner.within(ms);
    return this;
  }

  /**
   * Initial step matching a re-entered signal named `name` (the
   * `{ kind:"signal", name, ts, payload }` feedback contract). `name` is checked
   * against `keyof S` (typo-safe + autocomplete); the captured signal is added to
   * the `.emit` `Match` as `SignalEvent<S, N>` (so its `payload` is `S[N]`).
   */
  whenSignal<N extends keyof S & string>(
    name: N,
  ): TypedPattern<E, S, K, Captured | SignalEvent<S, N>> {
    this.inner = this.inner.when(
      (e) => (e as { kind?: unknown }).kind === "signal" && (e as { name?: unknown }).name === name,
    );
    return this as unknown as TypedPattern<E, S, K, Captured | SignalEvent<S, N>>;
  }

  /** Sequence step: a re-entered signal named `name` (see `whenSignal`). */
  thenSignal<N extends keyof S & string>(
    name: N,
  ): TypedPattern<E, S, K, Captured | SignalEvent<S, N>> {
    this.inner = this.inner.then(
      (e) => (e as { kind?: unknown }).kind === "signal" && (e as { name?: unknown }).name === name,
    );
    return this as unknown as TypedPattern<E, S, K, Captured | SignalEvent<S, N>>;
  }

  /** Negative step: NO re-entered signal named `name` before the window closes. */
  notThenSignal<N extends keyof S & string>(
    name: N,
  ): TypedPattern<E, S, K, Captured | SignalEvent<S, N>> {
    this.inner = this.inner.notThen(
      (e) => (e as { kind?: unknown }).kind === "signal" && (e as { name?: unknown }).name === name,
    );
    return this as unknown as TypedPattern<E, S, K, Captured | SignalEvent<S, N>>;
  }

  /**
   * Finalize. `fn` returns ONLY the payload, which must satisfy `S[K]`; the
   * wrapper injects `{ name, ts, payload }`. The `Match` sees `Captured` — the
   * user-event union widened by any signal steps. Returns the soft
   * `CompiledPattern` (the runtime handle) — `createTflo` re-types the hook's
   * output as `TypedSignal<S[K]>`.
   */
  emit(fn: (m: Match<Captured>) => PayloadFor<S, K>): CompiledPattern<E> {
    const name = this.name;
    return this.inner.emit((m) => {
      const match = m as unknown as Match<Captured>;
      return {
        name,
        ts: (match.last() as { ts: number }).ts,
        payload: fn(match) as Record<string, unknown>,
      };
    }) as unknown as CompiledPattern<E>;
  }
}
