# Scenario 10 — Progressive Disclosure (Interior Negation)

## Requirement

Show contextual help after **two failed attempts on a step with NO success between**,
within 30 000 ms of event-time → emit `{ signal: "show_help", step }`.

A fail → success → fail sequence **must be suppressed**: the success between the two
failures proves the user recovered and doesn't need the hint.

This is **interior negation** (`.notBetween`), not terminal negation (`.notThen`).
`notThen` can only say "A then absence-of-B within T"; it cannot say "A then B with
no C between A and B". Only interior negation can close the gap.

## tflo rule (per-step WasmPatternRuntime)

```js
new WasmPattern("progressive-disclosure")
  .timestamp(e => e.ts)
  .when(e => e.kind === "fail")
  .notBetween(e => e.kind === "success")
  .then(e => e.kind === "fail")
  .within(30000)
  .emit(() => ({ signal: "show_help", step }))
```

## Scenarios (one runtime per step id)

| Step | Events | Expected |
|------|--------|----------|
| S1 | fail@0, fail@2000 | `show_help` FIRES |
| S2 | fail@0, success@1000, fail@2000 | SUPPRESSED (success between the two fails) |

## Event shape

```json
{ "kind": "fail" | "success", "step": "S1" | "S2", "ts": <number ms> }
```

## Expected output

```json
[{"signal":"show_help","step":"S1"}]
```
