/**
 * `@tflo/react/cel` — CEL-string predicate patterns.
 *
 * **Opt-in and heavy** (~2 MB: it bundles a CEL interpreter). The main
 * `@tflo/react` package stays lean (~40 KB) and uses JS-closure predicates;
 * import from here only when you need predicates as **serializable data**.
 *
 * Why it matters: a CEL predicate is a string, not code, evaluated by the same
 * `cel-interpreter` that runs in the Rust backend. So a pattern can be authored
 * once, **shipped from a server at runtime**, stored, and evaluated *identically*
 * on client and server — the cross-tier predicate-parity / server-pushable
 * behavior the roadmap is about. CEL expressions reference event fields
 * directly, e.g. `kind == "add_to_cart"`.
 */
import initCepCel, {
  WasmPattern,
  WasmPatternRuntime,
  type WasmCompiledPattern,
} from "../wasm/cep-cel/tflo_cep_wasm.js";
import type { DerivedSignal, EmitOutput, Match } from "../core/pattern";
import type { TfloEvent, SignalMap } from "../typed/types";

let inflight: Promise<void> | null = null;
const isNode =
  typeof process !== "undefined" && !!(process as { versions?: { node?: string } }).versions?.node;

async function nodeBytes(rel: string): Promise<Uint8Array> {
  const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
  const { fileURLToPath } = await import(/* @vite-ignore */ "node:url");
  return readFile(fileURLToPath(new URL(rel, import.meta.url)));
}

/** Initialize the CEL-enabled CEP engine (separate, heavier wasm). */
export function initTfloCel(): Promise<void> {
  if (!inflight) {
    const init = isNode
      ? nodeBytes("../wasm/cep-cel/tflo_cep_wasm_bg.wasm").then((b) =>
          (initCepCel as (i?: unknown) => Promise<unknown>)({ module_or_path: b }),
        )
      : (initCepCel as () => Promise<unknown>)();
    inflight = init.then(() => undefined);
  }
  return inflight;
}

function normalize(raw: Array<unknown>, patternName: string): DerivedSignal[] {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return raw.map((item) => {
    const p = (item ?? {}) as EmitOutput;
    return { name: p.name ?? patternName, ts: p.ts ?? now, payload: p.payload ?? {} };
  });
}

/** A pattern whose predicates may be CEL strings (serializable) or JS closures. */
export class CelPattern<E extends { ts: number } = { ts: number }> {
  private inner: WasmPattern;
  constructor(name: string) {
    this.inner = new WasmPattern(name);
  }
  timestamp(fn: (e: E) => number): this {
    this.inner = this.inner.timestamp((e: unknown) => fn(e as E));
    return this;
  }
  /** Initial step with a CEL predicate string (e.g. `kind == "add_to_cart"`). */
  whenCel(expr: string): this {
    this.inner = this.inner.whenCel(expr);
    return this;
  }
  thenCel(expr: string): this {
    this.inner = this.inner.thenCel(expr);
    return this;
  }
  notThenCel(expr: string): this {
    this.inner = this.inner.notThenCel(expr);
    return this;
  }
  when(pred: (e: E) => boolean): this {
    this.inner = this.inner.when((e: unknown) => pred(e as E));
    return this;
  }
  then(pred: (e: E) => boolean): this {
    this.inner = this.inner.then((e: unknown) => pred(e as E));
    return this;
  }
  notThen(pred: (e: E) => boolean): this {
    this.inner = this.inner.notThen((e: unknown) => pred(e as E));
    return this;
  }
  within(ms: number): this {
    this.inner = this.inner.within(ms);
    return this;
  }
  /** Strict-`next` contiguity on the most recent step (see `Pattern.next`). */
  next(): this {
    this.inner = this.inner.next();
    return this;
  }
  /** `repeated(min..=max)` quantifier on the most recent step (see `Pattern.times`). */
  times(min: number, max: number = min): this {
    this.inner = this.inner.times(min, max);
    return this;
  }
  emit(fn: (m: Match<E>) => EmitOutput): CelCompiled<E> {
    return new CelCompiled<E>(this.inner.emit((raw: unknown) => fn(raw as Match<E>)));
  }
}

export class CelCompiled<E extends { ts: number } = { ts: number }> {
  readonly name: string;
  declare private readonly __brand: E | undefined;
  constructor(readonly inner: WasmCompiledPattern) {
    this.name = inner.name;
  }
  destroy(): void {
    this.inner.free();
  }
}

export class CelRuntime<E extends { ts: number } = { ts: number }> {
  private readonly inner: WasmPatternRuntime;
  readonly patternName: string;
  constructor(pattern: CelCompiled<E>) {
    this.inner = new WasmPatternRuntime(pattern.inner);
    this.patternName = pattern.name;
  }
  push(event: E): DerivedSignal[] {
    return normalize(this.inner.push(event), this.patternName);
  }
  flush(): DerivedSignal[] {
    return normalize(this.inner.flush(), this.patternName);
  }
  reset(): void {
    this.inner.reset();
  }
  destroy(): void {
    this.inner.free();
  }
}

/** A serializable pattern spec — the shape you could store or push from a server. */
export interface CelPatternSpec {
  name: string;
  when: string;
  then?: string[];
  notThen?: string;
  /** ms bound applied to the last step. */
  within?: number;
}

/**
 * Compile a serializable CEL pattern spec (data → pattern). `emit` maps the
 * match to a payload (kept as a JS function since output shaping is app-side).
 */
export function compileCelPattern<E extends { ts: number } = { ts: number }>(
  spec: CelPatternSpec,
  timestamp: (e: E) => number,
  emit: (m: Match<E>) => EmitOutput,
): CelCompiled<E> {
  let p = new CelPattern<E>(spec.name).timestamp(timestamp).whenCel(spec.when);
  for (const t of spec.then ?? []) p = p.thenCel(t);
  if (spec.notThen) p = p.notThenCel(spec.notThen);
  if (spec.within != null) p = p.within(spec.within);
  return p.emit(emit);
}

/**
 * A schema-typed serializable CEL spec. The signal `name` is pinned to a key of
 * the signal map `S`; the CEL strings stay opaque data (a string predicate
 * can't be statically field-checked), but the `name` and the emitted `payload`
 * ARE checked against the schema — the statically-knowable surface.
 *
 * Cross-step CEL: `then`/`notThen` predicates may reference earlier captures via
 * `first_<field>` / `prev_<field>` / `s{i}_<field>` (parity with `MatchContext`).
 */
export interface TypedCelSpec<S extends SignalMap, K extends keyof S & string> {
  name: K;
  when: string;
  then?: string[];
  notThen?: string;
  /** ms bound applied to the last step. */
  within?: number;
}

/**
 * Typed CEL bridge — `compileCelPattern` generic over `<E, S>`. The emit closure
 * returns ONLY the payload, checked against `S[K]`; the wrapper injects
 * `{ name, ts, payload }` (same contract as the typed `createTflo().usePattern`
 * `.emit`). Use it to author serializable/server-pushable CEL patterns that are
 * still schema-safe at the authoring boundary.
 */
export function compileTypedCelPattern<
  E extends TfloEvent,
  S extends SignalMap,
  K extends keyof S & string,
>(
  spec: TypedCelSpec<S, K>,
  timestamp: (e: E) => number,
  emit: (m: Match<E>) => S[K],
): CelCompiled<E> {
  let p = new CelPattern<E>(spec.name).timestamp(timestamp).whenCel(spec.when);
  for (const t of spec.then ?? []) p = p.thenCel(t);
  if (spec.notThen) p = p.notThenCel(spec.notThen);
  if (spec.within != null) p = p.within(spec.within);
  return p.emit((m) => ({
    name: spec.name,
    ts: m.last().ts,
    payload: emit(m) as Record<string, unknown>,
  }));
}
