# tflo-react — design spec

**Date:** 2026-05-31
**Status:** approved (brainstorm + FMECA tightening + senior-React pressure test), pending implementation plan
**Repo:** `tflo-react` (new sibling repo, peer to `tflo-browser-events`)

> **Strategic framing (read first).** The product is the **portable WASM CEP
> core**; `tflo-react` is its highest-leverage **on-ramp and demo surface**, kept
> deliberately thin. This is *not* a fat React-hooks framework — RxJS / XState /
> react-query / use-debounce already cover the local-only patterns and pay no
> WASM tax. tflo-react is worth building **only** as the shop window for
> engine-level superpowers (cross-tier parity, server-pushed behaviors,
> deterministic replay, offline/privacy) that no JS framework can match — and
> **only** if the CEL/parity roadmap (below) is committed to. See "Why WASM is
> the crown jewel" and "Is this worth building?".

---

## Thesis: temporal state is the missing React primitive

React has a first-class model for **state-at-an-instant** (`useState`) and, via
libraries, for **server state** (`useQuery`). It has **no** first-class model for
**time** and **event sequences**. Everything temporal — debounce, timeouts,
async races, gestures, presence, "X then Y within T" — is bolted on with
`useEffect` + refs + `setTimeout` + cleanup. That bolt-on is the single largest
source of React bugs and boilerplate.

`tflo-react` introduces the missing primitive: **temporal state**. It wraps the
`tflo-cep` WebAssembly engine (closure-based event-pattern matching, ~40 KB)
and exposes it as React hooks. The same conceptual leap `useQuery` made for
async, tflo makes for *time*.

### Sub-thesis: state as a projection of events, not effect soup

The React docs' "You Might Not Need an Effect" antipatterns split into two
kinds. **tflo deliberately owns only one of them**, and the spec is explicit
about the boundary so the claim stays credible:

- **Kind A — pure derivation (instantaneous).** `fullName = first + last`,
  `visibleTodos = todos.filter(...)`. No time involved. The correct fix is
  *compute during render* / `useMemo`. **tflo does not touch this.** The README
  says so out loud ("this one's a `useMemo`, not us").
- **Kind B — event- and time-driven state (temporal).** Effects that exist to
  *react to an event*, *chain `setState` cascades*, or *wrap timers/subscriptions
  to derive state over time*. This is the effect-soup tflo kills. State stops
  being *synchronized imperatively* and becomes *projected declaratively* — a
  fold/projection over an event stream, the way event-sourcing and CEP have
  always modeled it. `useReducer` gives the fold but is time-blind and still
  wired by hand; tflo adds temporal composition and declarative wiring.

Canonical before/after — search-as-you-type (the effect antipattern that bundles
debounce **and** a race):

```tsx
// BEFORE — effect manages state; debounce + race hand-rolled, stale results win
const [q, setQ] = useState("");
const [results, setResults] = useState([]);
useEffect(() => {
  const id = setTimeout(async () => setResults(await search(q)), 300); // stale q can overwrite
  return () => clearTimeout(id);
}, [q]);

// AFTER — state is composed, not synchronized
const debouncedQ = useDebounced(q, 300);
const results = useAsyncGuard(debouncedQ, search); // stale responses dropped, timeout built in
```

---

## Validation status (2026-05-31) — claim proven, with two corrections

The "missing primitive" claim was empirically tested via reproduction attempts
(RxJS + XState, best-effort, agents as fair proponents) for three event-time
behaviors. Code + evidence live in `validation/` (excluded from the npm
package). **Result: claim holds** — neither RxJS nor XState expresses event-time
CEP without hand-building a stream engine; their time operators are
processing-time/wall-clock (confirmed by running them). tflo implements all
three (283 green Rust tests). Two honest corrections surfaced:

1. **tflo had no keyed correlation join.** `window_join`
   (`tflo-core/src/combinators/join.rs`) was time-window only, no equi-key.
   **Resolved:** `keyed_window_join` added (key-equality + forward window),
   unit-tested, surfaced as `window_join_keyed` in `tflo-wasm`.
2. **Only the CEP subset was WASM-bound — now closed.** `tflo-ops`
   windows/keyed state/watermarks were proven in Rust but unreachable from the
   browser. **Both scenarios resolved + shipped:** `tflo-wasm` exports
   `window_join_keyed` (new `keyed_window_join` combinator) and `tumbling_window`
   (drives `TumblingSumOp` through `KeyedGraphState` + `OutOfOrderPolicy::Buffer`
   + watermark). Verified by native bridge tests, clean `wasm32` builds, the
   `tflo-react` suite (16 tests green), and three runnable `tflo.mjs` demos.
   This reverses the earlier over-pessimistic "not worth it without CEL"
   framing: the local value (a real event-time CEP engine in the browser) is
   large and unmatched in JS regardless of CEL; CEL is a separate axis
   (cross-tier predicate parity + server-push), tracked as future work.

## Why WASM is the crown jewel: cross-tier semantic parity

WASM here is **not** bought for performance — browser UI runs at dozens of
events/sec and the predicates are JS, so a pure-TS engine would be faster at the
boundary. WASM earns its place for one reason a JS library can never replicate:
**the exact same engine, with identical semantics, runs across the entire
stack** (browser, edge, service worker, Rust server). That unlocks four
superpowers no React/JS framework can offer by construction:

1. **One pattern, client + server, byte-identical.** Author a fraud / abuse /
   funnel / SLA pattern once; evaluate it client-side for instant UX *and*
   server-side for trust, with a guarantee they cannot disagree. Hand-rolled
   client heuristics vs server logic always drift; this removes the drift.
2. **Server-pushed behaviors, no redeploy.** A pattern is *data*, not code, so
   new temporal behavior can ship to live clients at runtime — feature-flag the
   *logic*, A/B-test *behaviors*, not just variants.
3. **Deterministic replay / temporal time-travel.** The engine is deterministic
   and event-sourced: record the event stream, replay it, and re-derive exactly
   why a signal fired or didn't — identically on client and server. Temporal
   bugs become reproducible; powers the devtool.
4. **Offline-first + privacy-preserving on-device computation.** All derivation
   runs locally — works offline, and ships *derived signals* (tiny) instead of
   the raw event stream (large, sensitive). Raw data can stay in the browser.

The engine is also framework-agnostic: the same WASM + a thin adapter works in
Svelte/Vue/Solid/vanilla. `tflo-react` is one binding of a portable core.

### Honest boundary: what v1 (JS-closure predicates) does and does not deliver

Superpowers **#1 and #2 require declarative predicates (CEL), not JS closures.**
A JS closure cannot run byte-identically in the Rust engine, and pushing JS
closures from a server is remote code execution. So:

- **v1 (JS-closure predicates):** full *engine* parity — the sequence / `within`
  / `notThen` **semantics** are byte-identical across tiers — plus replay (#3)
  and offline/privacy (#4). Excellent local DX.
- **v-next (CEL predicates, via `tflo-cel-parser`):** unlocks full *predicate*
  parity (#1) and safe server-push (#2). This is the roadmap that makes the wow
  unmatchable; the spec is explicit that v1 alone is "a nice React lib," and the
  engine-level moat lands with CEL.

This dependency is the crux of "is it worth building" — see that section.

---

## Positioning: when to reach for tflo (and when not)

Framed as alternatives + composability, not head-to-head superiority.

| You want… | Reach for | Why |
|---|---|---|
| Pure derived value from current state | **`useMemo`** (not tflo) | Instantaneous, no time axis |
| Server-state caching, stale-while-revalidate, request dedup | **react-query / SWR** | Purpose-built; tflo composes *around* it for the "when" |
| Rich stream operators (`map`/`merge`/`scan`/backpressure) | **RxJS** | Full reactive algebra; tflo is *not* an Rx replacement |
| Explicit finite-state modeling with visualizer | **XState** | Statecharts; tflo expresses *time-bounded* relations more tersely |
| One-off local debounce/throttle | **use-debounce** | 1 KB, zero setup; tflo only wins here when you're already in it |
| **Temporal patterns that also run identically server-side** | **tflo** | Cross-tier parity — unique |
| **Behavioral logic pushed/changed at runtime** | **tflo** | Patterns-as-data — unique |
| **Deterministic replay of why behavior fired** | **tflo** | Event-sourced + deterministic — unique |
| **On-device/offline behavioral derivation, ship signals not streams** | **tflo** | Local engine — unique |
| Composing derived signals into higher-order signals declaratively | **tflo** | Feedback / layered CEP — unique |

The honest rule: if your need is local-only and one of the incumbents covers it,
use the incumbent. tflo is for the bottom five rows — and for consolidating many
of the top rows into one grammar once you're already paying for the engine.

---

## Scope

**In scope (v1):**
- Engine-only React layer over the `tflo-cep` WASM bindings (`WasmPattern`,
  `WasmCompiledPattern`, `WasmPatternRuntime`). No dependency on
  `@tflo/browser-events`.
- Four core primitives + three composable building blocks + a minimal typed
  pattern facade.
- A **proven, small** ergonomic hook suite (5 hooks) built on the primitives;
  the rest ship as runnable recipes in `examples/`.
- One generic source adapter (`useEventSource`); DOM/WebSocket are recipes.
- A README organized around the thesis with impact-ordered, problem→solution
  demos and an "Effects you can delete" table.
- TypeScript throughout; tests driving the **real** WASM.

**Out of scope (v1):**
- DOM auto-capture / sinks / tracking plans (that is `tflo-browser-events`'
  job; tflo-react is source-agnostic and engine-only).
- Pure (non-temporal) state derivation — explicitly deferred to `useMemo`.
- A general stream-operator algebra (`map`/`filter`/`merge`/`scan` — i.e.
  RxJS). Source transforms live in plain JS in the `useEventSource` callback or
  in `useMemo`. **We do not reinvent Rx.**
- `<TfloScope>` parent-forwarding/`bubble` semantics (basic isolation only in
  v1; forwarding deferred to v1.1).
- WebSocket reconnect logic and a `useBehavior` preset library (speculative
  scope cut by the FMECA pass).
- Extracting a shared `@tflo/cep-js` core out of the two repos — deferred with
  an explicit migration plan (see Risks / builder drift); YAGNI until a third
  consumer appears.
- WASM CEL parser (tracked in tflo-cep roadmap, not gating this repo).

---

## Architecture: central runtime bus (approach A)

```
            dispatch(event)
producers ───────────────────▶  EventBus  ──push──▶  PatternRuntime registry
(handlers,                          │                 (one runtime / pattern)
 useEventSource,                    │                        │ emits
 manual, signal re-entry)           ▼                        ▼
                              (source-agnostic)        SignalRegistry
                                    ▲                  (latest signal per name
                                    │                   + per-name subscribers)
                          feedback: signals re-enter           │
                          as kind "signal" (depth-limited)     │
                                                    useSyncExternalStore
                                                               ▼
                                                      subscribed components
```

- `<TfloProvider>` initializes the WASM module **once** and owns the **event
  bus** and two registries (pattern runtimes, signals).
- Events enter via `dispatch` and are pushed **synchronously** into every
  registered `PatternRuntime` whose optional `kinds` filter matches (default:
  all). Emitted `DerivedSignal`s fan out to the **signal registry**, which
  re-renders only the subscribers for that signal name.
- **Where events come from is pluggable** via `useEventSource(subscribe)` or
  plain manual `dispatch`. The engine never knows the source.
- The shipped ergonomic hooks and the recipes are **thin compositions** over
  the core primitives + building blocks — that composition *is* the proof the
  primitive is powerful.

### Subscription substrate: `useSyncExternalStore`

The signal registry is an external mutable store; `useSyncExternalStore` is the
canonical concurrent-safe, SSR-safe, tearing-free way to subscribe React to it.
`useSignal` / `usePattern` read through a **per-signal-name store** so a
component subscribes narrowly to one signal. `getServerSnapshot` returns the
stable idle value so SSR/first-client paint match. This is the implementation
substrate, not an optional combination.

---

## Layering (the composability story)

```
Layer 0  WASM engine        sequence / negation / within  (matching)
Layer 1  Core primitives    TfloProvider · useEmit · usePattern · useSignal · useSignalCallback
         + building blocks     feedback (re-entry) · useWindow/useCount · <TfloScope>
Layer 2  Shipped hooks (5)  useDebounced · useThrottled · useIdle · useAsyncGuard · useRateLimit
Layer 3  Recipes (11)       3-line assemblies of Layers 1–2, copy-paste in examples/
```

Layers 2 and 3 are *provably* "just compositions," which is the strongest
evidence that the primitive is the missing one.

---

## Package layout

Mirrors `tflo-browser-events` conventions: own minimal typed facade over the
WASM bindings, WASM **committed as a prebuilt artifact** (regen via build
script against `../tflo/tflo-cep-wasm`, `TFLO_PATH` override), vitest.

```
tflo-react/
  src/
    core/
      provider.tsx        TfloProvider, TfloScope, context
      eventBus.ts         typed dispatch → runtimes (+ kinds routing, feedback)
      signalRegistry.ts   per-name external stores (useSyncExternalStore)
      runtimeRegistry.ts  single owner of compiled patterns + runtimes; frees them
      wasmInit.ts         idempotent async WASM init
      pattern.ts          minimal typed facade over WASM builder (+ golden vectors)
    hooks/
      useEmit.ts
      usePattern.ts       (supports { kinds?, feedback?, timestamp? })
      useSignal.ts
      useSignalCallback.ts
      useWindow.ts        useWindow / useCount  (sliding-window aggregate atom)
      useRecorder.ts      record event stream + replay() (deterministic)
    temporal/             shipped ergonomic hooks (compose core/)
      useDebounced.ts  useThrottled.ts  useIdle.ts  useAsyncGuard.ts  useRateLimit.ts
    sources/
      useEventSource.ts   generic subscribe→dispatch adapter
    devtools/             dev-only panel (separate entry, not in prod bundle)
  examples/               one per catalog entry; also the home of the 11 recipes
  tests/                  RTL + jsdom, real WASM
  scripts/build-wasm.sh
  wasm/                   committed prebuilt artifact + checksum
  parity/                 shared cross-tier vectors (client ≡ server semantics)
```

---

## Core API (primitives + building blocks)

```ts
// provider — one WASM init, holds bus + registries
<TfloProvider>{children}</TfloProvider>

// nestable isolated event space (basic isolation; no parent-forwarding in v1)
<TfloScope>{children}</TfloScope>

// emit — push an event from anywhere
const dispatch = useEmit<MyEvent>();
dispatch({ kind: "add_to_cart", ts: performance.now(), cartId });

// declare a pattern; get its latest signal as reactive state
const signal = usePattern("abandoned_cart", p =>
  p.when(e => e.kind === "add_to_cart")
   .notThen(e => e.kind === "purchase")
   .within(5 * 60_000)
   .emit(m => ({ cartId: m.first().cartId })),
  [/* deps */],
  { kinds: ["add_to_cart", "purchase"], feedback: false });

// decoupled consumer, or imperative side-effect (no re-render)
const last = useSignal("abandoned_cart");
useSignalCallback("abandoned_cart", s => toast.warn("Still there?"));

// building block: sliding-window aggregate (the count/aggregate atom)
const { events, count } = useWindow("click", { ms: 1000, maxEvents: 100 });
const n = useCount("error", { ms: 1000 });
```

- `ts` defaults to the provider's injectable `now()` (`performance.now()`) when
  omitted; per-pattern `timestamp(fn)` override required when events carry a
  domain timestamp in a different epoch.
- `kinds` (optional) routes an event only to interested runtimes — opt-in
  fan-out control; default broadcasts.
- `feedback: true` re-dispatches emitted signals into the bus as events of kind
  `"signal"` (depth-limited) so higher-order patterns can match derived signals.
- `usePattern` recompiles only when `deps` change; the **runtime registry** (not
  the hook) owns and frees the compiled pattern + runtime.

---

## Composable building blocks (Layer 1)

1. **Signal re-entry / feedback (`{ feedback: true }`).** A pattern's emitted
   signal is re-dispatched as an event (kind `"signal"`, carrying its name),
   enabling layered/hierarchical CEP: raw → derived → meta-signals, the way
   Rust composes. Guarded by a per-dispatch **re-entry depth limit** + dev cycle
   warning.
2. **Sliding-window aggregate (`useWindow` / `useCount`).** The WASM engine does
   sequences, not counts/aggregates. A JS-side ring buffer over a predicate/kind
   exposes reactive `{ events, count }` within a rolling `ms`, capped by
   `maxEvents`. The atom under rate-limit, coalescing, presence density, and
   milestone progress.
3. **Scope (`<TfloScope>`).** Nestable isolated event space for a subtree.
   Isolation is the default (each scope owns its bus); parent-forwarding
   deferred to v1.1.
4. **Recorder / replay (`useRecorder` + `replay()`).** Because the engine is
   deterministic, recording the dispatched event stream and re-pushing it
   through a fresh runtime re-derives the exact same signals. Enables temporal
   time-travel debugging and the devtool. Thin utility over `reset()` + buffered
   events; bounded by a `maxEvents` cap.

**Not built:** a general `map`/`filter`/`merge`/`scan` operator algebra.
Source transforms live in the `useEventSource` callback or `useMemo`.

### Devtool (`tflo-react/devtools`)

A dev-only panel — answers "why didn't my pattern fire?", which the pressure
test flagged as the make-or-break DX question. Scrub the recorded event
timeline; for each pattern see its **partial-match state** (which steps matched,
which `within` deadline is pending, when it expired); replay to a point in time.
Determinism makes this exact, not approximate. Ships separate from core (not in
the production bundle).

---

## Shipped vs recipe

**Shipped ergonomic hooks (5)** — proven-expressible, high-impact, stable API:
`useDebounced`, `useThrottled`, `useIdle`, `useAsyncGuard`, `useRateLimit`.

**Recipes (11)** — runnable, copy-paste in `examples/`; promote to a published
hook on demonstrated demand: `useSettled`, `useOnce`, `useOptimisticGuard`,
`usePresence`, `useConnectionHealth`, `useInteraction`, `useChord`,
`useLongPress`, `useBehavior`, `useSessionIdle`, `useCoalesced`, `useMilestone`.

> Power is preserved: every recipe appears in the README catalog and ships as
> example code; only the *committed API/version-lock surface* is reduced.

---

## Lifecycle & safety (the "error-proof" guarantees)

- **WASM handles always freed — single owner.** The runtime registry (not
  individual hooks) owns every compiled pattern + runtime and frees them on
  deregistration; a `FinalizationRegistry` is a backstop. A handle-leak
  assertion test guards this.
- **React 18 StrictMode-safe.** Registration is idempotent and ref-counted;
  `useSyncExternalStore` sub/unsub is idempotent.
- **SSR / Next.js-safe.** No `window`/WASM at import; init inside the provider
  effect; `getServerSnapshot` returns the idle value; `"use client"` documented.
- **Concurrent-render-safe.** No work during render; subscriptions via
  `useSyncExternalStore`; builders recompile only on `deps` change.
- **Feedback loop-safe.** Re-entry depth limit + dev cycle warning.
- **Bounded memory.** Window buffers capped by `maxEvents`; engine drops
  in-flight partial matches on `within` expiry (negatives require `within`).
- **High-frequency sources** sample at the `useEventSource` boundary.

---

## Observability (dev-only, behind a `debug` flag; silent in prod)

- Handle-count gauge + warn-on-nonzero-at-unmount (leak detection).
- Dispatch latency + registered-runtime count (fan-out cost).
- Partial-match count gauge (runtime memory).
- Time-skew warning when `|event.ts − now()|` exceeds a threshold.
- Re-entry depth / cycle warning (feedback).
- Builder golden-vector CI check (drift detection).
- The **devtool** (separate entry) is the primary "why didn't it fire?" surface:
  partial-match inspection + deterministic replay.

---

## Composition with other React primitives

tflo is one axis of derivation; the existing primitives are the other.

- **tflo × `useMemo` — two axes of derivation.** `useMemo` derives across
  *space* (current values); tflo across *time* (event history). Project the
  stream to a temporal signal with tflo, then `useMemo` over `(signal, props)`.
  Pure derivation is `useMemo`, **not tflo** — stated explicitly in the README.
- **tflo × `useSyncExternalStore`.** Our implementation substrate (above).
- **tflo × `useReducer` — temporal middleware.** Reducer holds domain state;
  tflo signals `dispatch` actions when a temporal condition fires.
- **tflo × `useDeferredValue` / `useTransition` — settle-then-transition.** A
  tflo idle/debounce signal gates when an expensive transition starts.
- **tflo × data fetching (`useQuery`) — tflo is the "when", the query the
  "what".** Temporal refetch/invalidation triggers + `useAsyncGuard` for
  race/timeout.
- **tflo × event handlers.** Handlers are the producers ("put the logic in the
  handler"); tflo composes the temporal relationships between the events they
  emit, instead of effect chains reacting to state.

These get a short README "Powerful combinations" section, one snippet each.

---

## Example catalog — ordered by impact, framed problem → solution

Each README entry uses three beats: **Problem** (the painful, bug-prone "before",
usually a gnarly `useEffect`), **Solution** (the tflo hook/recipe, a few lines),
**Why it's error-proof** (the class of bug now impossible).

| # | Problem | tflo solution | Ships as | Pattern primitive |
|---|---|---|---|---|
| 1 | `useEffect` async **races & missing timeouts** | `useAsyncGuard` / timeout | hook | `request(id)` notThen `response(id)` within T; drop stale |
| 2 | **debounce/throttle/idle** hand-rolled, edge bugs | `useDebounced` · `useThrottled` · `useIdle` | hook | event notThen same-event within T |
| 3 | **double-submit / rate-limit / idempotency** | `useRateLimit` · `useOnce` | hook / recipe | window count ≥ N within T → block |
| 4 | **optimistic UI rollback** | `useOptimisticGuard` | recipe | `applied` notThen `confirmed` within T → revert |
| 5 | **real-time presence / connection health** | `usePresence` · `useConnectionHealth` | recipe | heartbeat timeout; N misses within T (window) |
| 6 | **interaction/intent disambiguation** | `useInteraction` · `useChord` · `useLongPress` | recipe | strict sequence + within |
| 7 | **adaptive/behavioral UX** ("stuck→help", "rage→support") | `useBehavior` | recipe | sequences + negation + **feedback** |
| 8 | **idle session / auto-logout** | `useSessionIdle` | recipe | no-activity within T |
| 9 | **notification/error-storm coalescing** | `useCoalesced` | recipe | N within window → one summary (window) |
| 10 | **multi-step funnel / onboarding milestone** | `useMilestone` | recipe | strict ordered sequence (window for progress) |

#1–#5 are the heavy hitters (correctness + unique capability); #6–#10 round out
breadth. The recipes assemble from `usePattern` + `useWindow` + feedback.

---

## README shape (reordered — lead with the unmatchable, demote the commodity)

The pressure test showed that leading with "delete your debounce util"
*undersells* (every senior dev has `use-debounce`). Open with what nothing else
can do; let the timer utils be the "...and the boring stuff is trivial too."

1. **Thesis** — "temporal state, the missing React primitive" + the
   "state as a projection of events, not effect soup" sub-section (Kind A/B).
2. **The wow up front** — the crown-jewel demo: a pattern that runs **identically
   client + server**, plus the **feedback / layered-CEP** example (emergent
   behavioral signal from composed signals). This is the first-5-minutes payoff,
   and it justifies the provider immediately because no one-liner library can do
   it.
3. **30-second quickstart** — whose result is something RxJS/XState can't do in
   the same line count.
4. **When to reach for tflo (and when not)** — the positioning table; honesty
   builds trust and pre-empts "isn't this just RxJS/XState/react-query?".
5. **Composability** — layering diagram + the 3 building blocks
   (feedback, window, scope), one snippet each.
6. **The catalog** — impact-ordered problem → solution → why-error-proof.
7. **Effects you can delete** — antipattern → tflo replacement, including honest
   "this one's a `useMemo`, not us" rows.
8. **Powerful combinations** — tflo × useMemo / useReducer / useDeferredValue /
   useQuery.
9. **Devtools & replay** — record/scrub the event timeline, watch partial matches
   form and expire, replay to reproduce why a signal fired.
10. **...and the boring stuff** — `useDebounced`/`useThrottled`/`useIdle` in one
    line each (deliberately *not* the headline).
11. **Core primitives reference.**
12. **Lifecycle / SSR / observability notes.**
13. **Build from source.**

---

## Testing

vitest + `@testing-library/react` + jsdom, driving the **real** WASM (same
approach `tflo-browser-events` uses). Coverage:

- Per-hook + per-building-block tests: scripted event sequences → assert
  signals/state.
- Feedback test: derived signal re-enters and triggers a higher-order pattern;
  depth limit halts a cycle.
- Window test: rolling count correctness + `maxEvents` cap.
- Scope test: isolation between sibling scopes.
- StrictMode double-mount test (no double-register / double-free).
- SSR smoke test (renders before `ready`, no `window` at import).
- Handle-leak test (asserts `free` called on unmount / recompile).
- Builder **golden-vector** test shared with `tflo-browser-events` (drift).
- **Replay determinism** test: record → reset → re-push yields identical signals.
- **Cross-tier parity** vectors: the same pattern + event sequence produces the
  same signals through the WASM here and through the Rust engine (the crown-jewel
  guarantee, made testable). v1 covers engine/semantic parity; predicate parity
  lands with CEL.

---

## Incremental delivery

- **Phase 1:** repo init, WASM artifact, `TfloProvider`, 4 primitives, 1 example.
- **Phase 2:** building blocks (feedback, `useWindow`, `TfloScope`) + 5 shipped
  hooks + `useEventSource`.
- **Phase 3:** the 11 recipes/examples + README.
- Rollback is trivial (new repo, additive phases).

---

## Is this worth building? (strategic evaluation)

A senior-React pressure test surfaced an honest fork:

- **As a standalone fat React-hooks framework with JS-closure predicates only —
  NOT worth it.** RxJS / XState / react-query / use-debounce already cover every
  local-only demo, tree-shake to near-zero, and pay no 40 KB WASM tax. In that
  form a reviewer would correctly call it over-engineered, and the WASM is pure
  liability (bundle, setup tax, opaque debugging, SSR ceremony).
- **As a thin binding on a portable engine, committed to the CEL/parity roadmap
  — genuinely worth it.** The unmatchable value (cross-tier parity, server-push,
  replay, offline/privacy) is *engine*-level, and a beautiful React surface is
  the highest-leverage way to make it impressive and adopted. React is the shop
  window, not the product.

**Decision gate:** build `tflo-react` **iff** the team commits to the engine
roadmap (CEL predicates → predicate parity + safe server-push; pattern
serialization; shared parity vectors). If that commitment is not made, do **not**
build the React layer — it will not clear the "wow" bar on its own. Investment
priority: engine (CEL, serialization, parity, replay) > thin React binding >
ergonomic hooks > recipes.

## Risk posture (from the FMECA pass)

- **High risks:** none remain.
- **Medium (inherent / human-factors), reduced as far as the closure-based
  engine allows:**
  - *Fan-out without the optional `kinds` filter* — closures aren't statically
    analyzable; mitigated by opt-in `kinds` routing + source sampling +
    dispatch-latency observability.
  - *Stale-closure predicates* — mitigated by convention (predicates read event
    fields, not outer scope) + shipped eslint exhaustive-deps config.
- **Builder duplication drift** — copy now, **shared golden test-vectors** both
  repos run (CI detects drift), extract `@tflo/cep-js` when a third consumer
  appears (documented migration/removal plan).

---

## Roadmap (strategic — the engine moat) & deferred

These are the items the "is it worth building" gate depends on; they live in the
engine, with `tflo-react` as the surface that demonstrates them.

- **CEL predicates** (`tflo-cel-parser` → WASM) — unlocks predicate parity (#1)
  and safe server-pushed behaviors (#2). The keystone of the unmatchable wow.
- **Pattern serialization** — patterns as portable data (enables server-push,
  storage, cross-tier shipping).
- **Cross-tier parity vectors** — shared client/server conformance suite.
- **Devtool + replay** — partial-match inspection; ships v1, deepens with CEL.

Deferred / demand-driven:

- `<TfloScope>` parent-forwarding (`bubble`) — v1.1.
- Whether any recipe graduates to a shipped hook — demand-driven.
- Shared `@tflo/cep-js` builder extraction — on third consumer.
- Other framework bindings (Svelte/Vue/Solid) — the core is already agnostic.
