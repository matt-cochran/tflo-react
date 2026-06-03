/**
 * Typed `Pattern` builder — a thin TypeScript wrapper over the WASM
 * `WasmPattern` / `WasmCompiledPattern` / `WasmPatternRuntime`. Mirrors the
 * proven `tflo-browser-events` builder (same WASM ABI) so the matching engine
 * is identical across the two packages. A shared golden-vector test guards
 * against drift.
 */
import {
  WasmPattern,
  WasmPatternRuntime,
  type WasmCompiledPattern,
} from "../wasm/cep/tflo_cep_wasm.js";

/** What an emit closure receives — captured events from a successful match. */
export interface Match<E> {
  readonly patternName: string;
  readonly length: number;
  first(): E;
  last(): E;
  all(): E[];
  at(stepName: string): E | undefined;
}

/**
 * What a `then`/`notThen` predicate receives as its 2nd argument — the events
 * captured so far in the current partial match. Enables cross-step correlation
 * (e.g. `(e, ctx) => e.id === ctx.first()?.id`).
 */
export interface MatchContext<E> {
  readonly length: number;
  first(): E | undefined;
  last(): E | undefined;
  all(): E[];
  at(stepName: string): E | undefined;
}

export type EmitOutput = {
  name?: string;
  ts?: number;
  payload?: Record<string, unknown>;
  [k: string]: unknown;
};

export interface DerivedSignal {
  name: string;
  ts: number;
  payload: Record<string, unknown>;
}

/**
 * Why the engine discarded a partial match. Mirrors the native `DropReason`,
 * delivered across the WASM boundary as a string.
 * - `"max_in_flight"` — the bounded in-flight set overflowed (backpressure).
 * - `"deadline"` — a positive step's `within(...)` window closed unmatched.
 * - `"late"` — an event arrived behind the reorder buffer's event-time frontier
 *   (more than `maxLateness` out of order), so it couldn't be matched in order.
 */
export type DropReason = "max_in_flight" | "deadline" | "late";

/** Fluent pattern builder. Chain steps, finalize with `.emit(...)`. */
export class Pattern<E extends { ts: number } = { ts: number }> {
  private inner: WasmPattern;
  private finalized = false;

  constructor(name: string) {
    this.inner = new WasmPattern(name);
  }

  timestamp(fn: (e: E) => number): this {
    this.inner = this.inner.timestamp((e: unknown) => fn(e as E));
    return this;
  }
  when(pred: (e: E) => boolean): this {
    this.inner = this.inner.when((e: unknown) => pred(e as E));
    return this;
  }
  then(pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.then((e: unknown, ctx: unknown) =>
      pred(e as E, ctx as MatchContext<E>),
    );
    return this;
  }
  thenNamed(name: string, pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.thenNamed(name, (e: unknown, ctx: unknown) =>
      pred(e as E, ctx as MatchContext<E>),
    );
    return this;
  }
  /**
   * Attach an **interior-negation guard** to the NEXT positive (`then`) step:
   * while the match skips events waiting for that step, any event satisfying
   * `pred` kills the partial. Expresses "A then B with NO C in between" —
   * `.when(a).notBetween(c).then(b)` — which a terminal `notThen` cannot.
   */
  notBetween(pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.notBetween((e: unknown, ctx: unknown) =>
      pred(e as E, ctx as MatchContext<E>),
    );
    return this;
  }
  notThen(pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.notThen((e: unknown, ctx: unknown) =>
      pred(e as E, ctx as MatchContext<E>),
    );
    return this;
  }
  notThenNamed(name: string, pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.notThenNamed(name, (e: unknown, ctx: unknown) =>
      pred(e as E, ctx as MatchContext<E>),
    );
    return this;
  }
  within(ms: number): this {
    this.inner = this.inner.within(ms);
    return this;
  }

  /**
   * Make the most recent step **strictly contiguous**: the event immediately
   * following the previous capture must satisfy it, else the partial match dies.
   * Expresses "B directly follows A" / "no event between A and B". The default
   * (without `.next()`) is skip-till-match ("eventually").
   */
  next(): this {
    this.inner = this.inner.next();
    return this;
  }

  /**
   * Make the most recent step a `repeated(min..=max)` quantifier — it matches its
   * predicate between `min` and `max` times (capturing each), then advances.
   * Replaces faked count-via-repeated-`.then`. `min`/`max` are clamped to
   * `1 <= min <= max`.
   */
  times(min: number, max: number = min): this {
    this.inner = this.inner.times(min, max);
    return this;
  }

  emit(fn: (m: Match<E>) => EmitOutput): CompiledPattern<E> {
    const compiled = this.inner.emit((raw: unknown) => fn(raw as Match<E>));
    this.finalized = true;
    return new CompiledPattern<E>(compiled);
  }

  destroy(): void {
    if (!this.finalized) this.inner.free();
  }
}

export class CompiledPattern<E extends { ts: number } = { ts: number }> {
  readonly name: string;
  readonly inner: WasmCompiledPattern;
  declare private readonly __brand: E | undefined;
  constructor(inner: WasmCompiledPattern) {
    this.inner = inner;
    this.name = inner.name;
  }
  destroy(): void {
    this.inner.free();
  }
}

/** Streaming runtime: push events one at a time, collect emitted signals. */
export class PatternRuntime<E extends { ts: number } = { ts: number }> {
  private readonly inner: WasmPatternRuntime;
  readonly patternName: string;

  /**
   * @param maxLateness — when set, enable the event-time reorder buffer: events
   * arriving up to this many ms out of order are released to the matcher in
   * event-time order (later ones drop as `"late"`). Omit for in-order behaviour.
   */
  constructor(pattern: CompiledPattern<E>, maxLateness?: number) {
    this.inner = new WasmPatternRuntime(pattern.inner, maxLateness);
    this.patternName = pattern.name;
  }

  push(event: E): DerivedSignal[] {
    return this.normalize(this.inner.push(event));
  }
  flush(): DerivedSignal[] {
    return this.normalize(this.inner.flush());
  }
  /**
   * Advance logical time to `now` (ms) WITHOUT an event, firing any
   * deadline-reached matches — the self-driving "A then no B within T" case.
   * The provider's clock driver calls this at {@link nextDeadline}; the engine
   * reads no wall clock, so a tick-driven run is identical to an event at `now`.
   */
  tick(now: number): DerivedSignal[] {
    return this.normalize(this.inner.tick(now));
  }
  /** Earliest pending deadline (ms) across in-flight partials, or `undefined`. */
  get nextDeadline(): number | undefined {
    return this.inner.nextDeadline;
  }
  reset(): void {
    this.inner.reset();
  }
  destroy(): void {
    this.inner.free();
  }

  /**
   * Observe dropped partial matches (C2 → JS). The handler fires once per
   * discarded partial with the drop reason. RxJS drops silently under
   * backpressure; this makes the loss visible. Replaces any prior handler.
   */
  onDrop(handler: (reason: DropReason) => void): void {
    this.inner.setDropHandler((reason: string) => handler(reason as DropReason));
  }

  /** Monotonic lifetime count of partials this runtime has dropped. */
  get droppedCount(): number {
    return this.inner.droppedCount;
  }

  private normalize(raw: Array<unknown>): DerivedSignal[] {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return raw.map((item) => {
      const p = (item ?? {}) as EmitOutput;
      return {
        name: p.name ?? this.patternName,
        ts: p.ts ?? now,
        payload: p.payload ?? {},
      };
    });
  }
}
