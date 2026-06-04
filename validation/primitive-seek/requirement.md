# Primitive: State-as-of-T / roll-back (P2)

## Requirement

Re-derive the signals as they stood at event-time `T` by replaying only the
recorded events whose `ts <= T`. This is **roll-back** / **state-as-of-T**: a
trustworthy answer to "what did the system believe at time `T`?", not a guess and
not a separately-stored snapshot.

Because the tflo CEP engine is **pure** (event-time only, reads no wall-clock), a
**truncated** replay is **deterministic**: the same truncated log always yields
the same emitted signals. So "state as of `T`" is a mechanical, side-effect-free
computation derived from the one event log — a latent superpower a pure engine
packages for free, on top of the existing full `replay()`.

## Capability under test

- `recorder.replayUntil(t)` — the React hook addition (`src/hooks/useRecorder.ts`),
  surfaced via the `Recorder` interface exported from `src/index.ts`. It mirrors
  `replay()` exactly — `bus.reset()` (fresh runtimes), set the replaying guard,
  re-dispatch the recorded events in recorded order — but **filtered to `ts <= t`**,
  then clears the guard. `replay()` itself is unchanged (full replay).
- The determinism this relies on is exercised directly here: pushing only the
  `ts <= T` prefix of the log into a **fresh** `WasmPatternRuntime` (the same
  fresh-runtime-then-truncated-redispatch that `replayUntil` performs) and flushing.

## Scenario in this proof

Pattern: `a` THEN `b` → `"AB"` (a sequence; fires only once both have been seen in
event-time order). The completing `b` arrives **late**, at `ts=100`.

Log: `a@0`, `b@100`.

- `state-as-of-T(50)` — replay only `ts <= 50` → just `a@0` → sequence incomplete
  → **no** signal. (The state as it stood at `t=50`: `b` not yet seen.)
- `state-as-of-T(100)` — replay `ts <= 100` → `a@0`, `b@100` → sequence completes
  → **one** `"AB"` signal.

`as-of-T(50)` ≠ `as-of-T(100)` → the roll-back is real, and re-running the same
cutoff reproduces the same result → deterministic.

## Expected (self-asserted)

- `as-of-T(50)` is empty.
- `as-of-T(100)` has exactly one `"AB"` signal.
- The two as-of-T results differ (roll-back changes the answer).
- Re-running `as-of-T(100)` yields the identical result (determinism).

## Run

```
node validation/primitive-seek/seek.mjs   # prints PASS, exit 0
```

The standalone proof imports the WASM directly so it runs in plain Node ESM with
no build step. The same capability is exercised through the package in
`tests/recorderSeek.test.tsx` via `recorder.replayUntil(t)`.
