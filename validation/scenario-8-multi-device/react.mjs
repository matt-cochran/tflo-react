// SCENARIO 8 — Multi-device onboarding journey, plain-React way (no library).
// The keyed join buffer (Map) and the event-time window check are hand-rolled —
// exactly the state a React component would keep in refs. Correct output, zero
// temporal help from the framework. No watermark/eviction/late-data (Map grows).
//
// Output: [{"userId":"U1","deltaMs":600000}]  (self-asserted PASS).
const WINDOW = 1800000; // 30 minutes in ms

const starts = [
  { userId: "U1", ts: 0 },
  { userId: "U2", ts: 1000 },
];
const completes = [
  { userId: "U1", ts: 600000 },
  { userId: "U2", ts: 3600000 },
];

const startsById = new Map(); // hand-rolled join state
for (const s of starts) startsById.set(s.userId, s);

const out = [];
for (const c of completes) {
  const s = startsById.get(c.userId);
  if (!s) continue;
  if (c.ts >= s.ts && c.ts <= s.ts + WINDOW) // EVENT-TIME window, by hand
    out.push({ userId: s.userId, deltaMs: c.ts - s.ts });
}

console.log("react:", JSON.stringify(out));
const ok =
  out.length === 1 &&
  out[0].userId === "U1" &&
  out[0].deltaMs === 600000;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
