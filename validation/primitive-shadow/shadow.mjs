// PRIMITIVE — Shadow / canary rule rollout (P3), in tflo (the WASM CEP engine).
//
// Shadow mode = run a CANDIDATE temporal spec alongside the ACTIVE one over the
// SAME live event stream, WITHOUT acting on the candidate's output, and surface a
// live DIVERGENCE stream (signals emitted by exactly one side). This is how you
// canary a rule change safely: the active side is what a consumer acts on; the
// candidate is observed only, so a regression shows up as a divergence BEFORE it
// ships. It reuses the SAME parity/diff mechanism as backtest (primitive-backtest),
// but live — both runtimes are pushed every event as it arrives.
//
// Here the two specs differ ONLY in the abandonment window. A flow that completes
// at ts=2000 is abandoned under the candidate within=1000 (too slow) but NOT under
// the active within=5000 (in time). The divergence surfaces exactly that one
// candidate-side signal. Self-asserts → PASS/FAIL.
//
// Standalone: imports the WASM directly (no @tflo/react build needed), inlines a
// minimal copy of the diff core so it runs in plain Node ESM.
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

// ── Shadow diff core (mirrors src/core/backtest.ts diffSignals + src/hooks/useShadowSpec.ts) ──
function signalKey(s) {
  const p = s.payload ?? {};
  const id = p.id ?? p.flowId ?? p.entityId ?? p.key ?? "";
  const keys = Object.keys(p).sort();
  const sorted = {};
  for (const k of keys) sorted[k] = p[k];
  return `${s.name}|${s.ts}|${id}|${JSON.stringify(sorted)}`;
}

function normalize(raw, fallbackName) {
  const p = raw ?? {};
  return { name: p.name ?? p.signal ?? fallbackName, ts: p.ts ?? 0, payload: p.payload ?? {} };
}

// `removed` = baseline-only (active-only here); `added` = other-only (candidate-only).
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

// Run two specs over the SAME live event log, computing divergences as we go.
function runShadow(active, candidate, log) {
  const activeRt = new WasmPatternRuntime(active.build(new WasmPattern(active.name)), active.maxLateness);
  const candidateRt = new WasmPatternRuntime(
    candidate.build(new WasmPattern(candidate.name)),
    candidate.maxLateness,
  );
  const activeSignals = [];
  const candidateSignals = [];

  // Same live stream into BOTH runtimes (the heart of shadow mode).
  for (const e of log) {
    for (const s of activeRt.push(e)) activeSignals.push(normalize(s, active.name));
    for (const s of candidateRt.push(e)) candidateSignals.push(normalize(s, candidate.name));
  }
  // Flush any pending deadlines at end-of-stream (the live React hook gets these
  // via the clock-driven tick; here we drain at the end of the fixed log).
  for (const s of activeRt.flush()) activeSignals.push(normalize(s, active.name));
  for (const s of candidateRt.flush()) candidateSignals.push(normalize(s, candidate.name));

  const { added, removed } = diffSignals(activeSignals, candidateSignals);
  const divergences = [
    ...removed.map((signal) => ({ side: "active", signal })),
    ...added.map((signal) => ({ side: "candidate", signal })),
  ];
  activeRt.free();
  candidateRt.free();
  return { activeSignals, candidateSignals, divergences };
}

// ── Scenario ────────────────────────────────────────────────────────────────
const abandonedWithin = (name, within) => (p) =>
  p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "flow_started")
    .notThen((e) => e.kind === "flow_completed")
    .within(within)
    .emit((m) => ({ name: "abandoned", payload: { flowId: m.first().flowId } }));

const active = { name: "within-5000", build: abandonedWithin("within-5000", 5000) }; // acted on
const candidate = { name: "within-1000", build: abandonedWithin("within-1000", 1000) }; // observed only

const log = [
  { kind: "flow_started", flowId: "A", ts: 0 },
  { kind: "flow_completed", flowId: "A", ts: 2000 }, // slow: in time @5000, late @1000
];

const { activeSignals, candidateSignals, divergences } = runShadow(active, candidate, log);

console.log("log:               ", JSON.stringify(log));
console.log("activeSignals:     ", JSON.stringify(activeSignals));
console.log("candidateSignals:  ", JSON.stringify(candidateSignals));
console.log("divergences:       ", JSON.stringify(divergences));

// ── Self-assert ───────────────────────────────────────────────────────────
const ok =
  activeSignals.length === 0 && // active (loose) window: no abandonment → nothing acted on
  candidateSignals.length === 1 && // candidate (tight) window: abandoned
  candidateSignals[0].payload.flowId === "A" &&
  divergences.length === 1 && // exactly one side diverges
  divergences[0].side === "candidate" && // and it's the observed-only candidate
  divergences[0].signal.name === "abandoned" &&
  divergences[0].signal.payload.flowId === "A";

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
