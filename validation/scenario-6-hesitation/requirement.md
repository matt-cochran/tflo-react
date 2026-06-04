# Scenario 6 — Hesitation

## Requirement

A user focuses a form field and then edits it **two or more times** within a
5000 ms event-time window (without submitting) → **hesitation** signal.

One runtime per field (per-entity correlation via a fresh `WasmPatternRuntime`
for each field id).

## tflo rule

```js
new WasmPattern("hesitation")
  .timestamp(e => e.ts)
  .when(e => e.kind === "focus")
  .then(e => e.kind === "edit")
  .times(2, 10)     // min=2, max=10 — at least 2 edits after focus
  .within(5000)     // all edits must land within 5000 ms of focus
  .emit(() => ({ signal: "hesitation", field }))
```

## `times` semantics (discovered from engine source + quantifier tests)

`.times(min, max)` applies to the **most recently added step** (the `then`
predicate).

- While `repeat_count < max` and the predicate matches, each matching event
  increments `repeat_count` and is consumed (returns `Keep`).
- When `repeat_count >= max` the greedy cap is reached; the partial advances
  to the next step (or completes if this is the last step).
- When a **non-matching** event arrives and `repeat_count >= min`, the
  repetition is considered satisfied and the partial advances (re-offering the
  non-matching event to the next step).
- At **end-of-stream** (`flush()`), a terminal repeated step with
  `repeat_count >= min` fires — the run simply ended with enough matches.
- `within(5000)` attaches a deadline to the repeated step. If the min count is
  not reached before 5000 ms elapses, the partial is dropped silently.

## Fixtures

| Field | Events | repeat_count | Outcome |
|-------|--------|--------------|---------|
| F1 | focus@0, edit@500, edit@1000, edit@1500 | 3 (≥ min 2) | **FIRES** at flush |
| F2 | focus@0, edit@500 | 1 (< min 2) | **no signal** |

## Expected output

```json
[{"signal":"hesitation","field":"F1"}]
```
