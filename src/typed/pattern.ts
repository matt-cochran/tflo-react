/**
 * `TypedPattern` — a strict, generic facade over the soft runtime `Pattern`.
 *
 * Same fluent shape as `Pattern`, but with PER-STEP type tracking. The chain
 * accumulates a tuple `Steps extends readonly unknown[]`: each `.when/.then/
 * .whenSignal/...` appends the element type it captures. That tuple then drives:
 *
 *  - the `MatchContext` handed to a `.then/.notThen/.thenSignal` predicate, so
 *    `ctx.first()` is the FIRST step's type and `ctx.last()`/`ctx.all()` reflect
 *    the steps captured BEFORE the current one;
 *  - the `Match` handed to `.emit`, so `m.first()` is step 0's type, `m.last()`
 *    is the FINAL step's type, `m.all()` is a typed array of the step union, and
 *    `m.at(name)` is the step union.
 *
 * Event-step narrowing leans on TypeScript 5.5+ inferred type predicates: a bare
 * `e => e.kind === "connection_failed"` is inferred as a type guard, so `.when`'s
 * guard overload captures the narrowed variant (`connection_failed`) as that
 * step's element. A predicate the compiler cannot prove is a guard (e.g.
 * `e => e.ts > 0` or `e.kind === "x" && other`) resolves to the boolean overload,
 * which appends the full `E` union for that step — a safe, lossless fallback.
 *
 * Signal steps (`whenSignal/thenSignal/notThenSignal`) append `SignalEvent<S, N>`
 * so `m.first()` etc. see the typed re-entered signal (`payload` is `S[N]`).
 *
 * `.emit(fn)` takes a closure returning ONLY the payload, which must satisfy
 * `S[K]` (the payload type for this pattern's signal name `K`). The wrapper
 * injects `{ name, ts, payload }`. The step-tuple flows into `fn`'s `Match`, so
 * `m` is INFERRED — no hand annotation.
 *
 * The engine stays soft: every closure is cast at the boundary
 * (`(e: unknown) => pred(e as E)`). No WASM/runtime change.
 */
import { Pattern, type CompiledPattern } from "../core/pattern";
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

/** The last element of a step tuple (or its union, for an unknown-length tuple). */
type Last<Steps extends readonly unknown[]> = Steps extends readonly [...unknown[], infer L]
  ? L
  : Steps[number];

/**
 * Per-step `Match` (what `.emit` receives). `Steps` is the accumulated tuple of
 * captured step types; `first()` is `Steps[0]`, `last()` is the final step, and
 * `all()`/`at()` are the union of all steps. An empty chain degrades gracefully
 * (`Steps[0]`/`Last<[]>` are `undefined`/`never`-ish), but a real pattern always
 * has at least one step.
 */
export interface TypedMatch<Steps extends readonly unknown[]> {
  readonly patternName: string;
  readonly length: number;
  first(): Steps[0];
  last(): Last<Steps>;
  all(): Steps[number][];
  at(stepName: string): Steps[number] | undefined;
}

/**
 * Per-step `MatchContext` (what a `.then/.notThen/.thenSignal` predicate
 * receives). `Steps` here is the tuple of steps captured BEFORE the current one,
 * so `ctx.first()` is the first step's type and `ctx.last()` is the immediately
 * preceding step. All accessors are `| undefined` (a partial match may not yet
 * have reached a given step).
 */
export interface TypedMatchContext<Steps extends readonly unknown[]> {
  readonly length: number;
  first(): Steps[0] | undefined;
  last(): Last<Steps> | undefined;
  all(): Steps[number][];
  at(stepName: string): Steps[number] | undefined;
}

/**
 * `TypedPattern<E, S, K, Steps>`:
 *  - `E`     — the discriminated user-event union (`.when/.then/...`);
 *  - `S`     — the `{ signalName: payload }` map;
 *  - `K`     — this pattern's OWN signal name (pins `.emit`'s payload to `S[K]`);
 *  - `Steps` — the accumulated TUPLE of captured step types. Each step method
 *              appends its element: event steps append the narrowed variant (or
 *              `E` when the predicate isn't a provable guard); signal steps
 *              append `SignalEvent<S, N>`. Drives the per-step `Match`/
 *              `MatchContext` typing described above.
 */
export class TypedPattern<
  E extends TfloEvent,
  S extends SignalMap,
  K extends keyof S = keyof S,
  Steps extends readonly unknown[] = [],
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

  // ── Event steps. Two overloads each: a type-guard form that captures the
  //    narrowed variant `T` (via TS 5.5+ inferred predicates), and a boolean
  //    fallback that appends the full `E` union. ───────────────────────────────

  when<T extends E>(pred: (e: E) => e is T): TypedPattern<E, S, K, [...Steps, T]>;
  when(pred: (e: E) => boolean): TypedPattern<E, S, K, [...Steps, E]>;
  when(pred: (e: E) => boolean): TypedPattern<E, S, K, readonly unknown[]> {
    this.inner = this.inner.when((e) => pred(e as E));
    return this as unknown as TypedPattern<E, S, K, readonly unknown[]>;
  }

  then<T extends E>(
    pred: (e: E, ctx: TypedMatchContext<Steps>) => e is T,
  ): TypedPattern<E, S, K, [...Steps, T]>;
  then(
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, [...Steps, E]>;
  then(
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, readonly unknown[]> {
    this.inner = this.inner.then((e, c) =>
      pred(e as E, c as unknown as TypedMatchContext<Steps>),
    );
    return this as unknown as TypedPattern<E, S, K, readonly unknown[]>;
  }

  thenNamed<T extends E>(
    stepName: string,
    pred: (e: E, ctx: TypedMatchContext<Steps>) => e is T,
  ): TypedPattern<E, S, K, [...Steps, T]>;
  thenNamed(
    stepName: string,
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, [...Steps, E]>;
  thenNamed(
    stepName: string,
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, readonly unknown[]> {
    this.inner = this.inner.thenNamed(stepName, (e, c) =>
      pred(e as E, c as unknown as TypedMatchContext<Steps>),
    );
    return this as unknown as TypedPattern<E, S, K, readonly unknown[]>;
  }

  /**
   * Attach an **interior-negation guard** to the NEXT positive (`then`) step:
   * while the match skips events waiting for that step, any event satisfying the
   * predicate kills the partial — "A then B with NO C in between", which a
   * terminal `notThen` cannot express. A modifier on the *upcoming* step, so the
   * step tuple is unchanged (`this`).
   */
  notBetween(pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean): this {
    this.inner = this.inner.notBetween((e, c) =>
      pred(e as E, c as unknown as TypedMatchContext<Steps>),
    );
    return this;
  }

  notThen<T extends E>(
    pred: (e: E, ctx: TypedMatchContext<Steps>) => e is T,
  ): TypedPattern<E, S, K, [...Steps, T]>;
  notThen(
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, [...Steps, E]>;
  notThen(
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, readonly unknown[]> {
    this.inner = this.inner.notThen((e, c) =>
      pred(e as E, c as unknown as TypedMatchContext<Steps>),
    );
    return this as unknown as TypedPattern<E, S, K, readonly unknown[]>;
  }

  notThenNamed<T extends E>(
    stepName: string,
    pred: (e: E, ctx: TypedMatchContext<Steps>) => e is T,
  ): TypedPattern<E, S, K, [...Steps, T]>;
  notThenNamed(
    stepName: string,
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, [...Steps, E]>;
  notThenNamed(
    stepName: string,
    pred: (e: E, ctx: TypedMatchContext<Steps>) => boolean,
  ): TypedPattern<E, S, K, readonly unknown[]> {
    this.inner = this.inner.notThenNamed(stepName, (e, c) =>
      pred(e as E, c as unknown as TypedMatchContext<Steps>),
    );
    return this as unknown as TypedPattern<E, S, K, readonly unknown[]>;
  }

  within(ms: number): this {
    this.inner = this.inner.within(ms);
    return this;
  }

  /**
   * Make the most recent step **strictly contiguous** (`next`): the event
   * immediately following the previous capture must satisfy it, else the partial
   * match dies — "B directly follows A" / "no event between A and B". A modifier
   * on the last step, so the step tuple is unchanged.
   */
  next(): this {
    this.inner = this.inner.next();
    return this;
  }

  /**
   * Make the most recent step a `repeated(min..=max)` quantifier — it matches its
   * predicate between `min` and `max` times (each captured), then advances. A
   * modifier on the last step (the step tuple's element type is unchanged; the
   * step simply captures multiple events of that type). `min`/`max` are clamped
   * to `1 <= min <= max`.
   */
  times(min: number, max: number = min): this {
    this.inner = this.inner.times(min, max);
    return this;
  }

  // ── Signal steps. Each appends `SignalEvent<S, N>` to the step tuple, so the
  //    `.emit` Match sees the re-entered signal with `name: N` + `payload: S[N]`.

  /**
   * Initial step matching a re-entered signal named `name` (the
   * `{ kind:"signal", name, ts, payload }` feedback contract). `name` is checked
   * against `keyof S` (typo-safe + autocomplete); the captured signal is added to
   * the step tuple as `SignalEvent<S, N>` (so its `payload` is `S[N]`).
   */
  whenSignal<N extends keyof S & string>(
    name: N,
  ): TypedPattern<E, S, K, [...Steps, SignalEvent<S, N>]> {
    this.inner = this.inner.when(
      (e) => (e as { kind?: unknown }).kind === "signal" && (e as { name?: unknown }).name === name,
    );
    return this as unknown as TypedPattern<E, S, K, [...Steps, SignalEvent<S, N>]>;
  }

  /** Sequence step: a re-entered signal named `name` (see `whenSignal`). */
  thenSignal<N extends keyof S & string>(
    name: N,
  ): TypedPattern<E, S, K, [...Steps, SignalEvent<S, N>]> {
    this.inner = this.inner.then(
      (e) => (e as { kind?: unknown }).kind === "signal" && (e as { name?: unknown }).name === name,
    );
    return this as unknown as TypedPattern<E, S, K, [...Steps, SignalEvent<S, N>]>;
  }

  /** Negative step: NO re-entered signal named `name` before the window closes. */
  notThenSignal<N extends keyof S & string>(
    name: N,
  ): TypedPattern<E, S, K, [...Steps, SignalEvent<S, N>]> {
    this.inner = this.inner.notThen(
      (e) => (e as { kind?: unknown }).kind === "signal" && (e as { name?: unknown }).name === name,
    );
    return this as unknown as TypedPattern<E, S, K, [...Steps, SignalEvent<S, N>]>;
  }

  /**
   * Finalize. `fn` returns ONLY the payload, which must satisfy `S[K]`; the
   * wrapper injects `{ name, ts, payload }`. The `Match` is INFERRED from the
   * accumulated step tuple: `m.first()` is step 0, `m.last()` is the final step,
   * `m.all()`/`m.at()` are the step union — no hand annotation. Returns the soft
   * `CompiledPattern` (the runtime handle) — `createTflo` re-types the hook's
   * output as `TypedSignal<S[K]>`.
   */
  emit(fn: (m: TypedMatch<Steps>) => PayloadFor<S, K>): CompiledPattern<E> {
    const name = this.name;
    return this.inner.emit((m) => {
      const match = m as unknown as TypedMatch<Steps>;
      return {
        name,
        ts: (match.last() as { ts: number }).ts,
        payload: fn(match) as Record<string, unknown>,
      };
    }) as unknown as CompiledPattern<E>;
  }
}
