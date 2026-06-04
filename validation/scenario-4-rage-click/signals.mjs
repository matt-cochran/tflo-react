// SCENARIO 4 — Rage click, with Signals (@preact/signals-core).
// A signal holds the raw event log per target; a computed derives rage detections.
// The temporal logic inside the computed is hand-written — signals contribute
// reactivity (automatic re-derivation when the log updates), ZERO temporal correctness.
// The window arithmetic is the exact same anchor-based logic as react.mjs.
//
// Rule: ≥ 5 clicks where clicks 2–5 arrive within 2000ms of the FIRST (anchor) click.
//
// Output: [{signal:"rage",target:"T1"}]   (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WINDOW = 2000;
const MIN_BURST = 5; // 1 when + 4 then

const allEvents = [
  // T1 — burst
  { kind: "click", target: "T1", ts: 0 },
  { kind: "click", target: "T1", ts: 100 },
  { kind: "click", target: "T1", ts: 200 },
  { kind: "click", target: "T1", ts: 300 },
  { kind: "click", target: "T1", ts: 400 },
  // T2 — spaced
  { kind: "click", target: "T2", ts: 0 },
  { kind: "click", target: "T2", ts: 5000 },
];

// A signal holds the raw event log; a computed derives the verdict.
const log = signal(allEvents);

const rageSignals = computed(() => {
  // Group by target (preserve insertion order = event-time order)
  const byTarget = new Map();
  for (const e of log.value) {
    if (e.kind !== "click") continue;
    const clicks = byTarget.get(e.target) ?? [];
    clicks.push(e);
    byTarget.set(e.target, clicks);
  }

  const results = [];
  for (const [target, clicks] of byTarget) {
    // Anchor-based scan: same semantics as tflo's times(4,4).within(2000).
    let anchorTs = null;
    let count = 0;
    let fired = false;
    for (const e of clicks) {
      if (anchorTs === null) {
        anchorTs = e.ts;
        count = 1;
      } else if (e.ts - anchorTs <= WINDOW) {
        count += 1;
        if (!fired && count >= MIN_BURST) {
          results.push({ signal: "rage", target });
          fired = true;
        }
      } else {
        // Reset
        anchorTs = e.ts;
        count = 1;
        fired = false;
      }
    }
  }
  return results;
});

const out = rageSignals.value;
console.log("signals:", JSON.stringify(out));

const ok = out.length === 1 && out[0].signal === "rage" && out[0].target === "T1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
