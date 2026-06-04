# Scenario 4 — Rage Click (REPEAT quantifier)

## Requirement

A **rage click** is a burst of repeated clicks on the *same target element* within a short
event-time window. The pattern fires per-target using one `WasmPatternRuntime` per target id.

**Rule (per target, event-time):**
> A first click, then 4 more clicks within 2000 ms of the first click → emit `rage`.

Expressed in tflo:

```js
new WasmPattern("rage")
  .timestamp(e => e.ts)
  .when(e  => e.kind === "click")
  .then(e  => e.kind === "click")
  .times(4, 4)
  .within(2000)
  .emit(() => ({ signal: "rage", target }))
```

## `times` semantics (empirically confirmed)

| Call | Meaning |
|---|---|
| `.times(N, N)` on the `then` step | The `then` predicate must fire exactly N times. Total captured events = 1 (`when`) + N (`then`). |
| `.within(ms)` paired with `.times()` | Each repeated `then` event must arrive within `ms` of the **anchor (`when`) event** (not the previous step). A rolling chain of 1500 ms gaps across a 6000 ms span does **not** satisfy `within(2000)`. |

So `.times(4,4).within(2000)` requires 5 total clicks where clicks 2–5 all fall within 2000 ms
of click 1.

## Fixtures

| Target | Event-times (ms) | Expected |
|---|---|---|
| T1 (burst) | click@0, click@100, click@200, click@300, click@400 | `[{ signal:"rage", target:"T1" }]` |
| T2 (spaced) | click@0, click@5000 | `[]` (second click is 5000 ms from first — outside 2000 ms window) |

## Expected output (all implementations)

```json
[{"signal":"rage","target":"T1"}]
```

T2 produces no signal. The burst on T1 fires exactly once.
