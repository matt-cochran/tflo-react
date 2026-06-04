// PRIMITIVE — State-as-of-T / roll-back (P2), in tflo (the WASM CEP engine).
//
// Roll-back = re-derive the signals as they stood at event-time T by replaying
// only the events with `ts <= T`. Because the engine is pure (event-time only, no
// wall-clock), a truncated replay is fully deterministic: the same (truncated log)
// always yields the same signals, so "state as of T" is a mechanical computation,
// not a guess or a stored snapshot. This is the determinism that the React
// `recorder.replayUntil(t)` relies on.
//
// Here the pattern is a sequence `a` THEN `b` → "AB". The completing `b` arrives
// LATE (ts=100). Replaying with cutoff T1=50 (before `b`) yields NO signal — the
// system had not yet seen `b`. Replaying with cutoff T2=100 (including `b`) yields
// the "AB" signal. as-of-T1 ≠ as-of-T2 → roll-back works. Self-asserts → PASS/FAIL.
//
// Standalone: imports the WASM directly (no @tflo/react build needed), runs in
// plain Node ESM. Each cutoff uses a FRESH runtime — the same fresh-runtime +
// truncated-push that `replayUntil` does via `bus.reset()` then re-dispatch.
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

// `a` THEN `b` → "AB". Fires only once both have been seen in event-time order.
function buildAB() {
  return new WasmPattern("AB")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "a")
    .then((e) => e.kind === "b")
    .emit(() => ({ name: "AB", payload: {} }));
}

// State-as-of-T: replay ONLY events with ts <= t into a FRESH runtime, then flush.
// This is the pure-engine truncated replay that `recorder.replayUntil(t)` performs
// (bus.reset() = fresh runtime; re-dispatch ts<=t = the filtered push below).
function stateAsOf(log, t) {
  const rt = new WasmPatternRuntime(buildAB());
  const out = [];
  for (const e of log) {
    if (e.ts <= t) for (const s of rt.push(e)) out.push(s);
  }
  for (const s of rt.flush()) out.push(s);
  rt.free();
  return out;
}

// Event log: `a` at 0, then the LATE completing `b` at 100.
const log = [
  { kind: "a", ts: 0 },
  { kind: "b", ts: 100 }, // late: completes the sequence only at/after ts=100
];

const T1 = 50; // BEFORE the completing `b` → sequence incomplete
const T2 = 100; // INCLUDES the completing `b` → sequence completes

const asOfT1 = stateAsOf(log, T1);
const asOfT2 = stateAsOf(log, T2);

// Determinism check: re-running the same truncated replay must yield the same result.
const asOfT2Again = stateAsOf(log, T2);

console.log("log:        ", JSON.stringify(log));
console.log(`as-of-T(${T1}): `, JSON.stringify(asOfT1), "(rolled back — before `b`)");
console.log(`as-of-T(${T2}):`, JSON.stringify(asOfT2), "(rolled forward — includes `b`)");

// ── Self-assert ───────────────────────────────────────────────────────────
const name = (s) => s?.name ?? s?.signal;
const ok =
  asOfT1.length === 0 && // before the late `b`: no signal — the state at T1
  asOfT2.length === 1 && // including the late `b`: "AB" fires — the state at T2
  name(asOfT2[0]) === "AB" &&
  asOfT1.length !== asOfT2.length && // as-of-T1 ≠ as-of-T2 → roll-back is real
  asOfT2Again.length === asOfT2.length && // deterministic: same cutoff, same result
  name(asOfT2Again[0]) === name(asOfT2[0]);

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
