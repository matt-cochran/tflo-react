# tflo-react

**Temporal state for React.** The missing primitive for *time* and *event
sequences* — event-time complex-event-processing, powered by the
[`tflo`](https://github.com/matt-cochran/tflo) WASM engine (the same Rust
engine that runs server-side), surfaced as hooks.

> React has a first-class model for state-at-an-instant (`useState`) and, via
> libraries, for server state (`useQuery`). It has **no** first-class model for
> **time**. Debounce, timeouts, async races, gestures, presence, "X then Y
> within T" — all bolted on with `useEffect` + refs + `setTimeout` + cleanup.
> `tflo-react` makes temporal state a declarative primitive.

- [Why this exists (validated)](#why-this-exists-validated)
- [The wow: things nothing else does](#the-wow-things-nothing-else-does)
- [Quickstart](#quickstart)
- [Typed API (recommended)](#typed-api-recommended)
- [When to reach for tflo (and when not)](#when-to-reach-for-tflo-and-when-not)
- [Composability: primitives & building blocks](#composability-primitives--building-blocks)
- […and the boring stuff (timer utils)](#and-the-boring-stuff-timer-utils)
- [API reference](#api-reference)
- [Lifecycle / SSR](#lifecycle--ssr)
- [Testing](#testing)
- [Build from source](#build-from-source)
- [Status & honesty](#status--honesty)

---

## Why this exists (validated)

This isn't a claim — it's tested. We took three event-time behaviors and tried
each, best-effort, in **RxJS** and **XState**, then in **tflo**. The
reproductions live in [`validation/`](./validation) (excluded from the published
package) and run with `npm --prefix validation run all`.

| Behavior | RxJS | XState | tflo |
|---|---|---|---|
| **Abandoned flow** — `A` not followed by `B` within T (event-time) | hand-rolled watermark; idiomatic recipe is *wrong* | custom event-clock; FSM gives none of it | `when(a).notThen(b).within(T)` — native |
| **Temporal join** — match within an event-time window, by key | `join` not even exported; all hand-rolled | a stream engine written alongside XState | `useJoin(...)` — one call |
| **Out-of-order windows** — late event still lands in its bucket | `bufferTime` is processing-time → wrong | the wrong tool (a `reduce` in a costume) | `tumblingWindow(...)` — native |

In every case the incumbents required hand-building a stream engine; their time
operators are processing-time/wall-clock. tflo does it natively, with the
**same engine on the client and the Rust server**. See
[`validation/README.md`](./validation/README.md) for the full evidence.

## The wow: things nothing else does

**Layered CEP via feedback.** A pattern's emitted signal can re-enter the bus as
an event, so higher-order patterns compose on derived signals — the way you
compose in Rust:

```tsx
usePattern("rage", buildRageClick, [], { feedback: true });        // emits "rage"
usePattern("frustrated_session", (p) =>
  p.when((e) => e.kind === "signal" && e.name === "rage")
   .then((e) => e.kind === "signal" && e.name === "abandoned").within(60_000)
   .emit(() => ({ name: "frustrated_session" })), []);
```

**Cross-tier semantic parity.** The matching/windowing semantics are byte-
identical to your `tflo` Rust backend — author a funnel/abuse/SLA pattern once,
run it client-side for instant UX and server-side for trust. This is proven
end-to-end in the [`tflo-parity-demo`](../tflo-parity-demo): the same serializable
rule runs in the browser (WASM) and a native Rust server over gRPC-web, with a
live diff lane showing **0 divergence**, server-pushed rule updates, and
offline→reconcile.

**Patterns as data — server-pushable (`tflo-react/cel`).** Predicates can be
**CEL strings**, not JS closures — so a pattern is a serializable object,
evaluated by the same `cel-interpreter` that runs in the Rust backend. Author it
once, store it, **push it from a server at runtime**, and get byte-identical
*predicate* parity across tiers:

```ts
import { compileCelPattern, CelRuntime, initTfloCel } from "tflo-react/cel";
await initTfloCel();
const spec = { name: "abandoned", when: 'kind == "add_to_cart"',
               notThen: 'kind == "purchase"', within: 300000 }; // ← pure data
const rt = new CelRuntime(compileCelPattern(spec, (e) => e.ts,
  (m) => ({ name: "abandoned", payload: { cartId: m.first().cartId } })));
```

> Opt-in and **heavy** (~2 MB — it bundles a CEL interpreter). The default
> `tflo-react` stays lean (~40 KB) with JS-closure predicates; reach for `/cel`
> only when you need predicates as serializable/server-pushable data.

**Deterministic replay.** `useRecorder()` records the event stream; `replay()`
re-derives the exact same signals (the engine is deterministic) — temporal
time-travel debugging.

## Quickstart

```bash
npm install tflo-react react react-dom
```

```tsx
import { TfloProvider, useEmit, usePattern, useSignal } from "tflo-react";

function App() {
  return (
    <TfloProvider>
      <Cart />
    </TfloProvider>
  );
}

function Cart() {
  const dispatch = useEmit();

  // "added to cart but did not purchase within 5 minutes" — declaratively.
  const abandoned = usePattern("abandoned_cart", (p) =>
    p.timestamp((e) => e.ts)
     .when((e) => e.kind === "add_to_cart")
     .notThen((e) => e.kind === "purchase")
     .within(5 * 60_000)
     .emit((m) => ({ name: "abandoned_cart", payload: { cartId: m.first().cartId } })),
    []);

  if (abandoned) showWinback();

  return <button onClick={() => dispatch({ kind: "add_to_cart", ts: performance.now(), cartId: "x" })}>Add</button>;
}
```

`ts` is event-time taken from the event; the provider initializes the WASM
engine once. `useSignal("abandoned_cart")` is a decoupled consumer elsewhere in
the tree.

The hooks above are the **dynamic / escape-hatch** surface: events and signal
payloads are `unknown`-typed, which is what you want for CEL rules-as-data or
when the schema is only known at runtime. For application code, prefer the
**typed API** below.

## Typed API (recommended)

`createTflo<Events, Signals>()` gives you the **same hooks, fully type-safe**.
You declare your event union (`Events`, discriminated on `kind`) and your
signal→payload map (`Signals`) once; every hook is then bound to that schema.
The WASM engine stays "soft" internally — `createTflo` is a strict typed facade
that casts at the boundary, so there is no runtime cost and no engine change.

```tsx
import { createTflo, type TfloEvent } from "tflo-react";

// 1. Declare your schema once (module scope).
type Events =
  | { kind: "add_to_cart"; ts: number; cartId: string; sku: string }
  | { kind: "purchase"; ts: number; cartId: string };

type Signals = {
  abandoned_cart: { cartId: string };
  rage: { count: number };
};

// 2. Build the typed API.
export const t = createTflo<Events, Signals>();

// 3. Use the bound Provider + hooks everywhere — fully typed.
function App() {
  return (
    <t.Provider>
      <Cart />
    </t.Provider>
  );
}

function Cart() {
  const dispatch = t.useEmit(); // (e: Events) => void

  const abandoned = t.usePattern("abandoned_cart", (p) =>
    p.timestamp((e) => e.ts)
     .when((e) => e.kind === "add_to_cart") // inside, e.sku is `string`
     .notThen((e) => e.kind === "purchase")
     .within(5 * 60_000)
     // .emit returns ONLY the payload; it must satisfy Signals["abandoned_cart"].
     // The { name, ts, payload } envelope is injected for you.
     .emit((m) => ({ cartId: m.first().kind === "add_to_cart" ? m.first().cartId : "" })),
    []);

  // abandoned: TypedSignal<{ cartId: string }> | undefined
  if (abandoned) showWinback(abandoned.payload.cartId);

  return (
    <button
      // ✗ compile error: missing `sku`
      // onClick={() => dispatch({ kind: "add_to_cart", ts: performance.now(), cartId: "x" })}
      onClick={() => dispatch({ kind: "add_to_cart", ts: performance.now(), cartId: "x", sku: "y" })}
    >
      Add
    </button>
  );
}
```

What the types enforce, checked at compile time:

| Hook | Typed contract |
|---|---|
| `t.useEmit()` | `(e: Events) => void` — dispatching a malformed event is a compile error |
| `t.usePattern(name, build)` | `name` must be `keyof Signals`; `build`'s closures receive the discriminated `Events`; `.emit` must return `Signals[name]` |
| `t.useSignal(name)` | `TypedSignal<Signals[name]> \| undefined` |
| `t.useSignalCallback(name, fn)` | `fn` receives `TypedSignal<Signals[name]>` |
| `t.useWindow / useCount` | `kind` constrained to `Events["kind"]` |

The untyped hooks (`useEmit`, `usePattern`, …) remain exported for dynamic /
CEL use — `createTflo` is additive and backward-compatible.

## When to reach for tflo (and when not)

Framed as alternatives + composition, not competition.

| You want… | Reach for |
|---|---|
| A pure value derived from current state | **`useMemo`** — *not us* |
| Server-state caching / SWR / request dedup | **react-query / SWR** (tflo composes around it for the "when") |
| Rich generic stream operators (`map`/`merge`/`scan`) | **RxJS** — tflo is not an Rx replacement |
| Explicit statecharts with a visualizer | **XState** |
| A one-off local debounce | **use-debounce** (or our `useDebounced` if you're already here) |
| **Temporal patterns that also run identically server-side** | **tflo** |
| **Event-time joins / windows / out-of-order tolerance** | **tflo** |
| **Composing derived signals into higher-order signals** | **tflo** (feedback) |
| **Deterministic replay of why behavior fired** | **tflo** |

## Composability: primitives & building blocks

Everything is built from four primitives + three building blocks. The ergonomic
hooks are thin compositions of them — evidence the primitive is the right shape.

```
Core primitives   TfloProvider · useEmit · usePattern · useSignal · useSignalCallback
Building blocks    useWindow / useCount  ·  useJoin  ·  useRecorder  ·  <TfloScope>
Shipped hooks      useDebounced · useThrottled · useIdle · useRateLimit · useAsyncGuard
Engine facades     windowJoinKeyed · tumblingWindow · indicators.{sma,ema,rsi,…}
```

`useRateLimit`, for example, is one line over the `useWindow` building block:

```ts
export function useRateLimit(kind, { limit, ms }) {
  const count = useCount(kind, { ms });
  return { count, blocked: count >= limit };
}
```

## …and the boring stuff (timer utils)

Yes, it also deletes your timer-util graveyard — but this is deliberately *not*
the headline (every app already has `use-debounce`):

```ts
const q = useDebounced(input, 300);
const v = useThrottled(scrollY, 100);
const idle = useIdle(lastActivity, 30_000);
const { data, timedOut } = useAsyncGuard(query, search, { timeoutMs: 5000 }); // stale responses dropped
```

`useAsyncGuard` is the validated fix for the #1 `useEffect` async footgun: a
slower earlier response can never overwrite a newer one, and timeouts are
first-class.

## API reference

**Typed facade (recommended):** `createTflo<Events, Signals>()` returns a bound,
fully-typed `{ Provider, Scope, useEmit, usePattern, useSignal,
useSignalCallback, useWindow, useCount, useJoin, useRecorder, useTfloContext }`.
Types exported for schema authoring: `TfloEvent`, `SignalMap`, `TypedSignal<P>`.
See [Typed API](#typed-api-recommended).

**Provider:** `TfloProvider`, `TfloScope` (isolated nested event space),
`useTfloContext`.

**Primitives:** `useEmit()`,
`usePattern(name, build, deps, { kinds?, feedback?, partitionBy? })`,
`useSignal(name)`, `useSignalCallback(name, fn)`.

`partitionBy: e => e.flowId` makes a single `usePattern` track many concurrent
entities — each key gets its own isolated partial-match state:

```tsx
usePattern("abandoned", abandoned, [], { partitionBy: (e) => e.flowId });
// flow A completes in time → no signal; flow B never completes → abandoned(B)
```

**Building blocks:** `useWindow(kind, { ms, maxEvents })` → `{ events, count }`,
`useCount(kind, { ms })`, `useJoin(left, right, { key, ts?, window })`,
`useRecorder({ maxEvents })` → `{ events, replay, clear }`.

**Derived state, not stored state.** `useProjection(key, reducer, opts)` folds the
event stream (raw + derived) into a queryable *current state per entity* —
`status = fold(history)`, no status field, no flags. Incremental and bounded; a
correction is just a later event the reducer applies (last-writer-wins). This is
the read-model half of modeling business state as **cached history** rather than
hand-mutated flags.

**Self-driving deadlines (inject a clock).** "A then no B within T" fires on the
*absence* of an event — no cron, no `setTimeout`-and-flag. The engine exposes a
pure `tick(now)`; you **inject the clock** that drives it (the RxJS-`Scheduler`
shape — `now()` + `schedule()`):

```tsx
import { systemClock, ManualClock } from "tflo-react";
<Provider clock={systemClock}>   // live: wall-clock + setTimeout
<Provider clock={new ManualClock()}>  // virtual: advance() it — tests, replay, scrubbing
```

The *same* injected clock stamps omitted-`ts` events and schedules the wake-ups,
so event-time and deadline-time can never diverge. Omit the prop and the host
drives `useTfloContext().bus.tick(now)` itself. The engine reads no wall clock, so
a tick-driven run is byte-identical across replay and across tiers.

> Scope, honestly: `tick` advances *in-order* event-time. Out-of-order / late-
> arrival reordering (watermarks), cross-entity write-time invariants, and durable
> projection/timer backends are deliberate non-goals here — see the engine's
> non-goals. The in-memory projection + opt-in clock are the lean, default path.

**Provenance (opt-in):** pass `trace` to the provider (`<Provider trace>`) and the
library records every signal's `payload.causes` + raw events into a `TraceStore`,
exposed via `useTfloContext().trace` and the reactive **`useExplain(name)`** hook
(returns the latest cause tree — "why did this fire?"). Build a signal's causes
with the `causesFrom(m.all())` helper in `.emit`. Off by default (zero overhead).

```tsx
.emit((m) => ({ name: "DeveloperBlocked", payload: { causes: causesFrom(m.all()) } }))
// elsewhere, inside <Provider trace>:
const why = useExplain("DeveloperBlocked"); // { name, ts, kind, children: [...] }
```

**Hooks:** `useDebounced`, `useThrottled`, `useIdle`, `useRateLimit`,
`useAsyncGuard`.

**Pattern builder:** `Pattern` (`.timestamp/.when/.then/.notThen/.within/.emit`),
`CompiledPattern`, `PatternRuntime`. `then`/`notThen` predicates may take a
second `MatchContext` arg (`(e, ctx) => …`) for cross-step correlation.

**Engine facades:** `windowJoinKeyed`, `tumblingWindow`, and the
`indicators` namespace (`sma`, `ema`, `rsi`, `bollinger`, `macd`, `cross`,
`evaluateRules`) — the rest of tflo's streaming-analysis / CEL surface.

## Lifecycle / SSR

- **WASM handles always freed** — a single runtime registry owns every compiled
  pattern + runtime and frees them on unmount/recompile (leak-tested).
- **Race-proof registration** — patterns register **synchronously during render**
  (the first time the engine is `ready`), not in a passive effect, so a pattern
  mounted *after* the engine is ready can't miss an event dispatched in the same
  commit (e.g. from a sibling layout effect). Tested with an 8× no-flake gate.
- **React 18 StrictMode-safe** — ref-counted, id-keyed registration; double
  render/mount does not double-register or double-free (tested).
- **`useSyncExternalStore`** is the subscription substrate — concurrent-safe,
  per-signal-name, with a stable SSR snapshot.
- **SSR / Next.js** — no `window`/WASM at import; init happens in the provider
  effect; mark client components `"use client"`. Full bundler + SSR + lazy-load
  guide: **[docs/integration.md](docs/integration.md)**.
- **Buffer-until-ready** — the WASM engine initializes asynchronously, so an
  event dispatched before the engine is `ready` (e.g. fired from a component's
  mount effect) would otherwise hit zero registered runtimes and be silently
  dropped. The bus instead **queues** pre-ready events in an ordered FIFO
  (preserving each event's `ts`) and **drains** them in original order once the
  engine is ready. This is the pre-ready safety net; the *post*-ready
  same-commit race is closed separately by synchronous registration (above).
  After draining, the delivery path is the normal synchronous one
  (feedback/replay unchanged). The
  queue is capped at **10 000** events (`MAX_BUFFER`); on overflow the oldest are
  dropped and counted on `bus.droppedCount`.
- **Init-failure signal** — if WASM init *rejects*, the app must not hang
  silently. `useTfloContext()` exposes an **`error: unknown | null`** field: the
  provider catches the failure, sets `error`, and leaves `ready=false`. Render a
  fallback when `error` is non-null:

  ```tsx
  function Gate({ children }: { children: React.ReactNode }) {
    const { ready, error } = useTfloContext();
    if (error) return <EngineFailed error={error} />;
    if (!ready) return <Spinner />;
    return <>{children}</>;
  }
  ```

## Testing

`tflo-react/testing` gives consumers a deterministic surface so tests never
hand-roll registration gating (`waitFor(() => runtimes.size() > 0)`). It is
built on `@testing-library/react` (a test-only optional peer — never pulled into
the main bundle).

```tsx
import { renderWithTflo, dispatchAndSettle, TestClock } from "tflo-react/testing";

it("derives rage from clicks", async () => {
  let dispatch!: (e: Ev) => void;
  function App() {
    dispatch = useEmit<Ev>();
    usePattern<Ev>("rage", rage3, []);
    return <Signal name="rage" />;
  }

  // Resolves ONLY after the engine is ready (buffer drained).
  const { settle, ctx } = await renderWithTflo(<App />);

  const clock = new TestClock();
  dispatch({ kind: "click", ts: clock.now() });
  dispatch({ kind: "click", ts: clock.advance(200) });
  dispatch({ kind: "click", ts: clock.advance(200) });
  await settle();               // flush effects + microtasks + buffer drain

  expect(ctx.signals.get("rage")).toBeDefined();
});
```

- **`renderWithTflo(ui, opts?)`** — renders `ui` inside a `TfloProvider`,
  resolves once the engine is `ready` (or init errored, so failure tests don't
  hang), and returns the RTL result plus `settle()` and the live `ctx`.
  `opts.init` injects a custom (e.g. rejecting) engine init.
- **`settle()`** — flushes pending React effects + microtasks (and the bus
  buffer drain) so `dispatch(...); await settle();` deterministically observes
  signals without any `waitFor`.
- **`dispatchAndSettle(dispatch, events)`** — dispatch a list, then `settle()`.
- **`TestClock`** — deterministic monotonic event-time clock
  (`now` / `advance` / `set` / `reset`) for stamping test event `ts` values.

## Build from source

```bash
git clone https://github.com/matt-cochran/tflo        # next to this repo
git clone https://github.com/matt-cochran/tflo-react
cd tflo-react
npm install
npm run build:wasm    # wasm-pack builds ../tflo's cep + ops crates → src/wasm/
npm test              # full suite, driving the real WASM
npm --prefix validation run all   # RxJS vs XState vs tflo, side by side
```

`TFLO_PATH` overrides the default `../tflo` location.

## Status & honesty

- **Verified:** 16 tests green driving the real WASM (the 3 claim demos +
  primitives + every building block + all 5 hooks + composition + StrictMode
  no-leak + replay determinism). `tsc` clean. The three `validation/*/tflo.mjs`
  demos pass.
- **CEP correlation (closed):** two complementary mechanisms — `partitionBy`
  (one isolated runtime per key, at the binding layer) for per-entity tracking,
  and **`MatchContext`** (in the engine) for cross-step *value* correlation:
  `then`/`notThen` predicates receive a 2nd argument with the events captured so
  far, so `(e, ctx) => e.id === ctx.first()?.id` works in a single runtime.
- **CEL predicates (shipped, opt-in):** `tflo-react/cel` — serializable,
  server-pushable predicates with cross-tier *predicate* parity (~2 MB; v1 is
  event-field predicates, no cross-step CEL context yet).
- **Roadmap:** cross-step CEL context (CEL predicates that reference earlier
  captures, for full CEL parity with the JS `MatchContext`), and a broader
  `tflo-ops` hook surface. See `docs/superpowers/specs`.

## License

MIT OR Apache-2.0.
