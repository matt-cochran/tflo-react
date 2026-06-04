// PRIMITIVE — Backtest / what-if (P1), in tflo (the WASM CEP engine).
//
// Backtest = replay ONE recorded event log against MULTIPLE temporal rule specs
// and diff the results: "what-if I'd shipped rule B instead of rule A?". Because
// the engine is pure (event-time only, no wall-clock), the replay is fully
// deterministic — the same (log, spec) pair always yields the same signals, so a
// what-if is a mechanical computation, not a re-run of production.
//
// Here the two specs differ ONLY in the abandonment window. A flow that completes
// at ts=2000 is abandoned under within=1000 (too slow) but NOT under within=5000
// (in time). The diff surfaces exactly that one signal. Self-asserts → PASS/FAIL.
//
// Standalone: imports the WASM directly (no @tflo/react build needed), inlines a
// minimal copy of the runBacktest core so it runs in plain Node ESM.
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

// ── Pure backtest core (mirrors src/core/backtest.ts) ───────────────────────
function signalKey(s) {
  const p = s.payload ?? {};
  const id = p.id ?? p.flowId ?? p.entityId ?? p.key ?? "";
  const keys = Object.keys(p).sort();
  const sorted = {};
  for (const k of keys) sorted[k] = p[k];
  return `${s.name}|${s.ts}|${id}|${JSON.stringify(sorted)}`;
}

function runSpec(log, spec) {
  const compiled = spec.build(new WasmPattern(spec.name));
  const rt = new WasmPatternRuntime(compiled, spec.maxLateness);
  const out = [];
  for (const e of log) for (const s of rt.push(e)) out.push(normalize(s, spec.name));
  for (const s of rt.flush()) out.push(normalize(s, spec.name));
  rt.free();
  return out;
}

function normalize(raw, fallbackName) {
  const p = raw ?? {};
  return { name: p.name ?? p.signal ?? fallbackName, ts: p.ts ?? 0, payload: p.payload ?? {} };
}

function diffSignals(baseline, other) {
  const count = (list) => {
    const m = new Map();
    for (const s of list) m.set(signalKey(s), (m.get(signalKey(s)) ?? 0) + 1);
    return m;
  };
  const baseCounts = count(baseline);
  const otherCounts = count(other);
  const added = [];
  for (const s of other) {
    const k = signalKey(s);
    const rem = baseCounts.get(k) ?? 0;
    if (rem > 0) baseCounts.set(k, rem - 1);
    else added.push(s);
  }
  const removed = [];
  for (const s of baseline) {
    const k = signalKey(s);
    const rem = otherCounts.get(k) ?? 0;
    if (rem > 0) otherCounts.set(k, rem - 1);
    else removed.push(s);
  }
  return { added, removed };
}

function runBacktest(log, specs) {
  const perSpec = {};
  for (const spec of specs) perSpec[spec.name] = runSpec(log, spec);
  const diff = {};
  const baseline = perSpec[specs[0].name];
  for (let i = 1; i < specs.length; i++) {
    diff[specs[i].name] = diffSignals(baseline, perSpec[specs[i].name]);
  }
  return { perSpec, diff };
}

// ── Scenario ────────────────────────────────────────────────────────────────
const abandonedWithin = (name, within) => (p) =>
  p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "flow_started")
    .notThen((e) => e.kind === "flow_completed")
    .within(within)
    .emit((m) => ({ name: "abandoned", payload: { flowId: m.first().flowId } }));

const specs = [
  { name: "within-5000", build: abandonedWithin("within-5000", 5000) }, // baseline
  { name: "within-1000", build: abandonedWithin("within-1000", 1000) },
];

const log = [
  { kind: "flow_started", flowId: "A", ts: 0 },
  { kind: "flow_completed", flowId: "A", ts: 2000 }, // slow: in time @5000, late @1000
];

const { perSpec, diff } = runBacktest(log, specs);

console.log("log:", JSON.stringify(log));
console.log("perSpec.within-5000 (baseline):", JSON.stringify(perSpec["within-5000"]));
console.log("perSpec.within-1000:          ", JSON.stringify(perSpec["within-1000"]));
console.log("diff[within-1000]:            ", JSON.stringify(diff["within-1000"]));

// ── Self-assert ───────────────────────────────────────────────────────────
const d = diff["within-1000"];
const ok =
  perSpec["within-5000"].length === 0 && // loose window: no abandonment
  perSpec["within-1000"].length === 1 && // tight window: abandoned
  perSpec["within-1000"][0].payload.flowId === "A" &&
  d.added.length === 1 && // the diff surfaces exactly that one signal
  d.added[0].payload.flowId === "A" &&
  d.removed.length === 0;

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
