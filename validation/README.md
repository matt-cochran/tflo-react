# Validation — proving the claims

This directory is **evidence**, not product. It is intentionally excluded from
the published `@tflo/react` npm package (see the `files` allowlist in the root
`package.json`). It exists so every claim in the main README is backed by a
runnable reproduction that anyone can re-run.

**The claim under test:** *React (and the JS ecosystem at large) has no
first-class primitive for **event-time** complex-event-processing. The incumbent
libraries cannot express it without you hand-building a stream engine.*

We test this by taking three representative event-time behaviors and genuinely
attempting each in **RxJS** and **XState** (best-effort, by agents instructed to
act as expert *proponents* of each library — not to strawman them), then
comparing against **tflo**, which implements them natively.

## How to run

```bash
cd validation
npm install          # rxjs + xstate (dev-only; never shipped)
npm run all          # runs all 7 reproductions and prints their output
```

All programs ran clean during authoring (rxjs 7.8.2, xstate 5.32.0, Node ≥18).

## The three scenarios

| # | Behavior | Event-time challenge |
|---|---|---|
| 1 | **Abandoned flow** | A `flow_started` NOT followed by `flow_completed` within 5000ms of *event-time* → emit `abandoned`. |
| 2 | **Temporal join** | Join a payment to its order when `payment.ts ∈ [order.ts, order.ts+3000]` (event-time window). |
| 3 | **Out-of-order windows** | Tumbling 2000ms event-time windows; a late event (ts=1000 arriving *after* ts=3000) must still land in `[0,2000)`. |

## Results

Verdicts come directly from the reproduction attempts. `EVENT-TIME CORRECTNESS`
is the key column — "manual" means the library contributed **none** of the
temporal correctness; it was hand-written.

| Scenario | Library | Verdict | Event-time correctness | Core LOC | Ran? |
|---|---|---|---|---|---|
| 1 Abandoned flow | RxJS | Achievable with heavy custom code | only-with-manual-bookkeeping | ~14 (correct) / engine ~30–50 (unbounded) | ✅ |
| 1 Abandoned flow | XState | Achievable with heavy custom code | only-with-manual-bookkeeping | ~36 | ✅ |
| 1 Abandoned flow | **tflo** | **Implemented + tested (WASM today)** | **native** | builder: 5 calls | ✅ 10 tests |
| 2 Temporal join | RxJS | Achievable with heavy custom code | only-with-manual-bookkeeping | ~15 (no watermark/TTL) | ✅ |
| 2 Temporal join | XState | Achievable with heavy custom code | only-with-manual-bookkeeping | ~70 | ✅ |
| 2 Temporal join | **tflo** | **Implemented + WASM-bound** | **native** | bridge: 1 call | ✅ engine + bridge tests |
| 3 Out-of-order windows | RxJS | Achievable only by building an engine | only-with-manual-bookkeeping | ~20 (watermark) | ✅ |
| 3 Out-of-order windows | XState | **Not achievable without building an engine** | only-with-manual-bookkeeping | ~10 (FSM inert) | ✅ |
| 3 Out-of-order windows | **tflo** | **Implemented + WASM-bound** | **native** | `tumbling_window` (1 call) | ✅ engine + bridge + JS demo |

### What each reproduction demonstrated

**RxJS.** Every time operator it offers — `timer`, `debounceTime`, `windowTime`,
`bufferTime`, `throttleTime`, `auditTime`, `timeout` — is **processing-time
(wall-clock)** and cannot read a `ts` field from the payload. Confirmed
empirically: the idiomatic abandoned-flow recipe (`timer(5000)` race) returns
`[]`; `bufferTime` buckets all out-of-order events into one wrong bucket;
`join`/`groupJoin` are not even exported in RxJS 7. The `groupBy + reduce`
pattern looks clean but only works because the array source *completes* — on a
live `Subject` it emits nothing. Correct event-time behavior is always a
hand-built watermark engine; RxJS is just the transport.

**XState.** A great fit for a single entity's *lifecycle* (the per-flow
`waiting → completed/abandoned` machine is genuinely nice). But it has no
event-time concept: `after`/delays are wall-clock, so event-time required a
hand-built virtual clock driven from `ts`. For windowed aggregation (scenario 3)
the machine adds literally nothing — it degrades to a `reduce` in a costume.
Two real v5.32 footguns were hit (`event.type` vs `event.kind` silent no-match;
`sendParent` from a final state throws).

**tflo.** Scenario 1 is implemented, tested (10 passing `tflo-cep` tests), and
**exposed to WASM today**. Scenarios 2 and 3 are implemented and tested in the
Rust engine (283 green tests across `tflo-cep` + `tflo-ops`) but are **engine-
only — not yet bound to WASM**.

## Honest findings about tflo (corrections surfaced by this validation — now resolved)

Validation is only credible if it corrects us too. Two findings surfaced, and
both have since been **addressed in the engine + WASM wrapper**:

1. **No keyed correlation join existed.** tflo's `window_join` joins purely on a
   symmetric *time* window (no equi-key). **Resolved:** added
   `keyed_window_join` to `tflo-core/src/combinators/join.rs` (key-equality +
   forward window), with unit tests, surfaced as `window_join_keyed` in
   `tflo-wasm`.
2. **Only the CEP subset was WASM-bound — now both gaps are closed.**
   - **Scenario 2:** `tflo-wasm` exports `window_join_keyed` (the new
     `keyed_window_join` combinator added to `tflo-core`).
   - **Scenario 3:** `tflo-wasm` exports `tumbling_window`, which drives the
     engine's `TumblingSumOp` through the keyed-graph executor
     (`KeyedGraphState` + `OutOfOrderPolicy::Buffer` + watermark). The
     out-of-order claim holds exactly: the late `ts=1000` (arriving after
     `ts=3000`) lands in `[0,2000)`.
   Both are verified by native bridge tests, clean `wasm32-unknown-unknown`
   builds, the `@tflo/react` TypeScript suite (16 tests green), and the
   `scenario-*/tflo.mjs` demos in this folder. Broader `tflo-ops` surface
   remains future work.

The per-scenario tflo equivalents driving these WASM functions from JS — the
runnable three-way side-by-side (RxJS vs XState vs tflo) — are the next step.

## Conclusion

The claim holds, with evidence: **no JS library expresses event-time CEP without
the user hand-building the engine.** tflo is that engine, proven by tests; the
work ahead is surfacing more of it through WASM and wrapping it ergonomically in
React. The per-scenario tflo equivalents (driving the real WASM) will be added
here as those bindings land, so this suite becomes a three-way, runnable
side-by-side: RxJS vs XState vs tflo-react.
