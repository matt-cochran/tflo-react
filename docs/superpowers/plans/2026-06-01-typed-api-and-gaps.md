# tflo-react: Fully-Typed Public API + Gap Closure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Give `@tflo/react` a strongly-typed public API (generic event + signal schemas threaded through every hook), so a large codebase can wire up temporal behavior with full type safety and **without CEL** — while the WASM engine stays "soft" (`unknown`) internally. Then close the remaining adoption gaps (typed layering, first-class provenance, CEL safety, integration/SSR, CEP maturity).

**Architecture:** A **typed facade over a soft engine.** The current untyped hooks (`usePattern`, `useEmit`, …) remain the runtime core. A new `createTflo<E, S>()` factory returns *bound, generically-typed* wrappers that cast at the boundary (`(e: unknown) => pred(e as E)`) — no runtime/engine change. `E` = a discriminated-union event type; `S` = a `{ signalName: payloadType }` map. The wrapper makes signal names `keyof S`, infers `.emit` payloads from `S[name]`, and adds typed `.whenSignal/.thenSignal/.notThenSignal` for type-safe layering.

**Tech Stack:** TypeScript (generics, conditional/mapped types, literal inference), React 18, Vitest + **`expect-type`** (compile-time type tests) + `@testing-library/react`. No engine/Rust change for Phases 1–3.

**Reference:** library at `/home/mc/working/tflo-react`; the demo (`../tflow-adaptive-onboarding-demo`) is the consumer that proves the ergonomics. Current public surface: `src/index.ts`.

---

## Design: the typed contract (what we're building toward)

```ts
export interface TfloApi<E extends TfloEvent, S extends SignalMap> {
  Provider: React.FC<{ children: React.ReactNode; init?: InitFn }>;
  Scope: React.FC<{ children: React.ReactNode }>;
  useEmit: () => (event: E) => void;
  usePattern: <K extends keyof S & string>(
    name: K,
    build: (p: TypedPattern<E, S>) => TypedCompiled<E, S[K]>,
    deps?: React.DependencyList,
    opts?: UsePatternOpts<E>,
  ) => DerivedSignal<S[K]> | undefined;
  useSignal: <K extends keyof S & string>(name: K) => DerivedSignal<S[K]> | undefined;
  useSignalCallback: <K extends keyof S & string>(name: K, fn: (s: DerivedSignal<S[K]>) => void) => void;
  useWindow: (kind: E["kind"], opts: WindowOpts) => WindowState<E>;
  useCount: (kind: E["kind"], opts: WindowOpts) => number;
  useJoin: <L extends E, R extends E>(left: L[], right: R[], cfg: KeyedJoinConfig) => JoinedPair<L, R>[];
  useRecorder: (opts?: RecorderOpts) => Recorder<E>;
  useTfloContext: () => TfloContextValue;
  // dynamic/escape hatch — the existing untyped hooks remain importable from "@tflo/react"
}

export type TfloEvent = { kind: string; ts: number };
export type SignalMap = Record<string, unknown>; // soft constraint; user supplies a precise map

export function createTflo<E extends TfloEvent, S extends SignalMap>(): TfloApi<E, S>;
```

`TypedPattern<E, S>`: same fluent shape as `Pattern` but
- `.when/.then/.notThen` predicates receive `E` (discriminated → `e.kind` narrows fields);
- `.then/.notThen` also receive a typed `MatchContext<E>`;
- `.whenSignal/.thenSignal/.notThenSignal(name: keyof S)` add a signal step; the captured event for that step is `DerivedSignal<S[name]>`;
- `.emit(fn)` where `fn: (m: TypedMatch<…>) => Payload` and the wrapper injects `name` — so the user returns ONLY the payload, which must satisfy `S[K]`.

Engine stays soft: `TypedPattern` delegates to the runtime `Pattern`, casting closures. **No Rust/WASM change in Phases 1–3.**

---

## Phase 1 — `createTflo<E,S>()` typed wrapper (the centerpiece)

### Task 1.1: Type-test harness + `TfloEvent`/`SignalMap` types

**Files:** Create `src/typed/types.ts`; add `expect-type` devDep; Test `tests/typed/types.test-d.ts`

- [ ] **Step 1:** `npm i -D expect-type`. Add `tests/**/*.test-d.ts` to a `typecheck` script: `"typecheck:types": "tsc -p tsconfig.json --noEmit"` (the `.test-d.ts` files are type-only assertions compiled by tsc).
- [ ] **Step 2:** Write `src/typed/types.ts`:

```ts
export type TfloEvent = { kind: string; ts: number };
export type SignalMap = Record<string, unknown>;
/** A derived signal carrying a typed payload. */
export interface TypedSignal<P> { name: string; ts: number; payload: P; }
```

- [ ] **Step 3:** Write a failing type test `tests/typed/types.test-d.ts` using `expectTypeOf` asserting `TypedSignal<{a:number}>["payload"]` is `{a:number}`. Run `npm run typecheck:types` → must compile (type tests fail by FAILING TO COMPILE; a correct assertion compiles clean, a wrong one errors).
- [ ] **Step 4:** Commit `feat(typed): schema types + expect-type harness`.

### Task 1.2: `TypedPattern` builder (soft delegate, strict surface)

**Files:** Create `src/typed/pattern.ts`; Test `tests/typed/pattern.test.ts` + `tests/typed/pattern.test-d.ts`

- [ ] **Step 1: Runtime test** — a `TypedPattern<E,S>` produces the same matches as the raw `Pattern` for the abandoned-cart shape (drive a `PatternRuntime`, assert the emitted payload). 
- [ ] **Step 2: Type test** — `.when(e => e.kind === "add_to_cart")` narrows so `e.sku` is `string`; `.emit(m => ({ cartId: m.first().cartId }))` is accepted, while `.emit(() => ({ wrong: 1 }))` is a type error (assert via `// @ts-expect-error`).
- [ ] **Step 3: Implement** `src/typed/pattern.ts`:

```ts
import { Pattern, type CompiledPattern, type Match, type MatchContext } from "../core/pattern";
import type { TfloEvent, SignalMap } from "./types";

export class TypedPattern<E extends TfloEvent, S extends SignalMap, Captured = E> {
  constructor(private inner: Pattern<TfloEvent>, private name: string) {}
  timestamp(fn: (e: E) => number): this { this.inner = this.inner.timestamp((e) => fn(e as E)) as never; return this; }
  when(pred: (e: E) => boolean): this { this.inner = this.inner.when((e) => pred(e as E)) as never; return this; }
  then(pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.then((e, c) => pred(e as E, c as MatchContext<E>)) as never; return this; }
  notThen(pred: (e: E, ctx: MatchContext<E>) => boolean): this {
    this.inner = this.inner.notThen((e, c) => pred(e as E, c as MatchContext<E>)) as never; return this; }
  within(ms: number): this { this.inner = this.inner.within(ms) as never; return this; }
  // payload typed to the signal name K via the factory (see 1.3)
  emit<P>(fn: (m: Match<E>) => P): CompiledPattern<TfloEvent> {
    const name = this.name;
    return this.inner.emit((m) => ({ name, ts: (m as Match<E>).last().ts, payload: fn(m as Match<E>) }));
  }
}
```

- [ ] **Step 4:** Run both tests → green. **Step 5:** Commit `feat(typed): TypedPattern builder`.

### Task 1.3: `createTflo` factory — bound typed hooks

**Files:** Create `src/typed/createTflo.tsx`; Test `tests/typed/createTflo.test.tsx` + `.test-d.ts`

- [ ] **Step 1: Runtime test (RTL + `@tflo/react/testing`)** — `const t = createTflo<Events, Signals>()`; render `t.Provider` + a probe that `t.useEmit()`s an `add_to_cart` then (after `settle`) `t.useSignal("abandoned_cart")` reflects the abandoned signal. Assert payload `cartId`.
- [ ] **Step 2: Type tests (`.test-d.ts`)**:
  - `t.useEmit()` is `(e: Events) => void`; `dispatch({ kind: "add_to_cart", ts, cartId })` errors (missing `sku`).
  - `t.usePattern("not_a_signal", …)` errors (name not in `keyof Signals`).
  - `t.useSignal("abandoned_cart")` is `DerivedSignal<{cartId:string}> | undefined`.
  - `t.useSignalCallback("rage", s => s.payload.count)` — `count` is `number`.
- [ ] **Step 3: Implement** `src/typed/createTflo.tsx` — wrap the existing hooks, binding `E`/`S`:

```ts
import * as core from "../index";  // the untyped runtime hooks
import { TypedPattern } from "./pattern";
import type { TfloEvent, SignalMap, TypedSignal } from "./types";

export function createTflo<E extends TfloEvent, S extends SignalMap>() {
  return {
    Provider: core.TfloProvider,
    Scope: core.TfloScope,
    useTfloContext: core.useTfloContext,
    useEmit: () => core.useEmit() as (e: E) => void,
    usePattern: <K extends keyof S & string>(
      name: K,
      build: (p: TypedPattern<E, S>) => ReturnType<TypedPattern<E, S>["emit"]>,
      deps: React.DependencyList = [],
      opts?: core.UsePatternOpts<E>,
    ) =>
      core.usePattern(name, (raw) => build(new TypedPattern<E, S>(raw, name)), deps, opts as never) as
        | TypedSignal<S[K]> | undefined,
    useSignal: <K extends keyof S & string>(name: K) =>
      core.useSignal(name) as TypedSignal<S[K]> | undefined,
    useSignalCallback: <K extends keyof S & string>(name: K, fn: (s: TypedSignal<S[K]>) => void) =>
      core.useSignalCallback(name, fn as never),
    useWindow: (kind: E["kind"], opts: core.WindowOpts) => core.useWindow<E>(kind, opts),
    useCount: (kind: E["kind"], opts: core.WindowOpts) => core.useCount(kind, opts),
    useJoin: core.useJoin as <L extends E, R extends E>(l: L[], r: R[], c: core.KeyedJoinConfig) => core.JoinedPair<L, R>[],
    useRecorder: core.useRecorder,
  };
}
```

(Refine the `emit` payload-from-`S[K]` inference: make `usePattern`'s `build` return type carry the payload constraint via a `TypedCompiled<E, S[K]>` brand so `.emit`'s return must equal `S[K]`. Iterate on the generics until the Step-2 `@ts-expect-error` cases hold.)

- [ ] **Step 4:** Run runtime + type tests → green. **Step 5:** Export `createTflo` + types from `src/index.ts`. Commit `feat(typed): createTflo<E,S> factory — fully typed public API`.

### Task 1.4: README — "Typed API" section + migrate the Quickstart

- [ ] Show the `createTflo<Events, Signals>()` quickstart as the RECOMMENDED path; keep the untyped hooks documented as the dynamic/escape-hatch + CEL path. Commit `docs: typed API`.

---

## Phase 2 — Typed layering + first-class provenance

### Task 2.1: Typed signal steps `.whenSignal/.thenSignal/.notThenSignal`

**Files:** Modify `src/typed/pattern.ts`; Test `tests/typed/signal-steps.test.tsx` + `.test-d.ts`

- [ ] Add to `TypedPattern`: `whenSignal<K extends keyof S & string>(name: K)`, `thenSignal`, `notThenSignal`. Each adds a step with predicate `(e) => (e as any).kind === "signal" && (e as any).name === name`, and types the captured event as `TypedSignal<S[K]>` so the emit/match sees the typed payload. This REPLACES the demo's stringly `isSignal("X")`.
- [ ] Type test: `.whenSignal("not_a_signal")` errors; inside, the captured payload is `S["rage"]`.
- [ ] Runtime test: a layered pattern (`whenSignal("rage").thenSignal("abandoned_cart")`) fires when those signals are fed back. Commit `feat(typed): typed signal steps for layered CEP`.

### Task 2.2: First-class provenance in the library

**Files:** Create `src/core/provenance.ts` (promote from the demo's `TraceStore`); wire optional capture into the bus; Test `tests/provenance.test.ts`

- [ ] Promote `CauseRef`/`TraceNode`/`TraceStore`/`explain()` into the library. Add an opt-in: `TfloProvider` accepts `trace?: boolean`; when on, the bus records each signal's `causes` (from `emit` payload `causes` OR auto-derived from the match's captured events) + raw events, exposed via `useTfloContext().trace?.explain(name, ts)`. Add `useExplain(name)` hook.
- [ ] Tests: explain tree for a 2-layer pattern. Commit `feat: first-class provenance (trace + explain)`. Then update the demo to consume the library's provenance instead of its local `TraceStore`.

---

## Phase 3 — Safety & integration hardening

### Task 3.1: CEL must never panic
**Files:** Modify `tflo-cep-wasm/src/lib.rs` (the only Rust touch in this plan); Test in tflo-react `tests/cel.test.ts`

- [ ] Malformed CEL currently can hit an uncatchable wasm `unreachable`. Wrap CEL compile + execute in `std::panic::catch_unwind` (or validate before compile) so `compileCelPattern`/`whenCel` always return a catchable JS error, never a panic. Test: a fuzz set of malformed expressions all throw catchable errors; rebuild wasm. Commit (in tflo) `fix(cep-wasm): CEL never panics on malformed input`.

### Task 3.2: Airtight registration (remove effect-ordering dependence)
**Files:** Modify `src/hooks/usePattern.ts`, `src/core/runtimeRegistry.ts`; Test `tests/registration.test.tsx`

- [ ] Register synchronously on first render via a ref-initializer (idempotent, StrictMode-safe; reconcile/free in the effect cleanup), so dispatch-after-mount can't race even for dynamically-mounted patterns post-`ready`. Keep buffer-until-ready as the pre-ready safety net. Test: mount a pattern AND dispatch in the same commit (no `settle`) → signal observed; 8× no flake. Commit `feat: synchronous pattern registration (race-proof)`.

### Task 3.3: Zero-config integration + SSR honesty
**Files:** `README.md`; a `docs/integration.md`

- [ ] Document the bundler wasm story (incl. the Vite `server.fs.allow` gotcha for `file:` consumers and the published-package case), the `"use client"` / client-island SSR boundary, and lazy-loading the heavy `ops`/`cel` entries. Add a `peerDependencies` note. Commit `docs: integration + SSR boundary + bundling`.

---

## Phase 4 — CEP engine maturity (Rust; heavier; can ship after 1.0 of the typed API)

> Flagged separate/optional — these need `tflo-cep` engine work and are not required for the typed-API value.

- [ ] `repeated(n..=m, pred)` quantifier sugar (replaces faked count-via-repeated-`.then`).
- [ ] Cross-step CEL context (CEL predicates referencing earlier captures — full parity with the JS `MatchContext`).
- [ ] `next` vs `eventually` contiguity option (so "no X *between* A and B" is expressible).
- [ ] Typed CEL bridge: `compileCelPattern` generic over `<E, S>` so CEL specs are checked against the schema where statically possible.

---

## Self-Review

- **Spec coverage:** fully-typed public API ✔ (Phase 1), "no CEL needed" ✔ (typed closures are the primary path; CEL optional), typed layering / kill stringly-`isSignal` ✔ (2.1), first-class provenance ✔ (2.2), CEL safety ✔ (3.1), airtight registration ✔ (3.2), integration/SSR/bundle ✔ (3.3), CEP maturity ✔ (Phase 4, flagged). Soft-inside/strict-outside ✔ (engine untouched in 1–3; casts at the boundary).
- **No placeholders:** Phase 1 carries real wrapper code; the generic-inference refinement in 1.3 is bounded by the concrete `@ts-expect-error` acceptance cases in 1.3 Step 2.
- **Type consistency:** `TfloEvent`/`SignalMap`/`TypedSignal`/`createTflo<E,S>`/`TypedPattern<E,S>` used consistently; `DerivedSignal<P>` (typed) aligns with the existing `DerivedSignal` (which becomes generic, defaulting to `Record<string,unknown>` for backward compat — verify the untyped hooks still type-check).
- **Risk:** the hardest part is the `.emit` payload-from-`S[K]` inference and the `whenSignal` captured-type threading; both are pinned by `.test-d.ts` assertions so "it compiles" means "it's typed right." Backward compatibility: the untyped hooks remain; `createTflo` is additive.
