# Scenario 5 — Card-Testing Fraud Detection (Interior Negation)

## Problem

Card-testing fraud: an attacker tries stolen card numbers in rapid succession.
The signature is **two payment failures for the same card with NO successful
payment between them**, within a 60-second event-time window.

A fail → success → fail sequence is **SUPPRESSED** — the success in the middle
proves the card worked, so no fraud signal fires.

## Why this matters

Interior negation ("no B between A and C") cannot be expressed as a terminal
`notThen`. Terminal `notThen` says "A, then never B within T". Interior
`notBetween` says "A, then C, but with no B between them" — the pattern has
three roles (anchor, forbidden, confirmation) and the time window bounds the
anchor-to-confirmation span, not the anchor-to-negation absence.

## tflo rule (per-card WasmPatternRuntime)

```js
new WasmPattern("card_testing")
  .timestamp(e => e.ts)
  .when(e => e.kind === "fail")
  .notBetween(e => e.kind === "success")
  .then(e => e.kind === "fail")
  .within(60000)
  .emit(() => ({ signal: "card_testing", card }))
```

The `.notBetween(pred)` call attaches an interior-negation guard to the
following `.then(...)` step: while the partial match waits for the second
`fail`, any `success` event kills it immediately.

## Test events

| card | ts    | kind    |
|------|-------|---------|
| C1   | 0     | fail    |
| C1   | 1000  | fail    |
| C2   | 0     | fail    |
| C2   | 500   | success |
| C2   | 1000  | fail    |

## Expected result

```json
[{ "signal": "card_testing", "card": "C1" }]
```

- **C1**: two consecutive fails, no success between → `card_testing` fires.
- **C2**: fail → success → fail sequence → SUPPRESSED (success resets it).
