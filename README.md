# @tflo/react

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
- [When to reach for tflo (and when not)](#when-to-reach-for-tflo-and-when-not)
- [Composability: primitives & building blocks](#composability-primitives--building-blocks)
- […and the boring stuff (timer utils)](#and-the-boring-stuff-timer-utils)
- [API reference](#api-reference)
- [Lifecycle / SSR](#lifecycle--ssr)
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
run it client-side for instant UX and server-side for trust.

**Deterministic replay.** `useRecorder()` records the event stream; `replay()`
re-derives the exact same signals (the engine is deterministic) — temporal
time-travel debugging.

## Quickstart

```bash
npm install @tflo/react react react-dom
```

```tsx
import { TfloProvider, useEmit, usePattern, useSignal } from "@tflo/react";

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
- **React 18 StrictMode-safe** — ref-counted registration; double-mount does not
  double-register or double-free (tested).
- **`useSyncExternalStore`** is the subscription substrate — concurrent-safe,
  per-signal-name, with a stable SSR snapshot.
- **SSR / Next.js** — no `window`/WASM at import; init happens in the provider
  effect; mark client components `"use client"`.

## Build from source

```bash
git clone https://github.com/matt-cochran/tflo        # next to this repo
git clone https://github.com/matt-cochran/tflo-react
cd tflo-react
npm install
npm run build:wasm    # wasm-pack builds ../tflo's cep + ops crates → src/wasm/
npm test              # 16 tests, driving the real WASM
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
- **Roadmap (the deeper moat):** CEL predicates (for full cross-tier *predicate*
  parity + server-pushed patterns), a devtools panel (partial-match inspection),
  and broader `tflo-ops` surface. See `docs/superpowers/specs`.

## License

MIT OR Apache-2.0.
