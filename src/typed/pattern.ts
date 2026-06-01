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

export class TypedPattern<E extends TfloEvent, S extends SignalMap, K extends keyof S = keyof S> {
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
   * Finalize. `fn` returns ONLY the payload, which must satisfy `S[K]`; the
   * wrapper injects `{ name, ts, payload }`. Returns the soft `CompiledPattern`
   * (the runtime handle) — `createTflo` re-types the hook's output as
   * `TypedSignal<S[K]>`.
   */
  emit(fn: (m: Match<E>) => PayloadFor<S, K>): CompiledPattern<E> {
    const name = this.name;
    return this.inner.emit((m) => {
      const match = m as unknown as Match<E>;
      return {
        name,
        ts: match.last().ts,
        payload: fn(match) as Record<string, unknown>,
      };
    }) as unknown as CompiledPattern<E>;
  }
}
