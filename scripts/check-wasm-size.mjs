#!/usr/bin/env node
/**
 * Size-budget guard (poka-yoke against silent wasm bloat). Gzips each shipped
 * artifact and fails if it exceeds its budget. Run after `build:wasm`. Budgets
 * are wire (gzip) bytes with headroom over the current measured sizes; tighten
 * as the artifacts shrink. A breach is a real regression — investigate before
 * raising a budget (e.g. an accidental CEL/regex/chrono dependency creeping in).
 */
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(here, "..", "src", "wasm");

// name → [relative .wasm path, gzip budget in bytes]
const BUDGETS = {
  cep: ["cep/tflo_cep_wasm_bg.wasm", 25_000], // lean core — the `.` entry
  ops: ["ops/tflo_wasm_bg.wasm", 140_000], // math-only — `./ops`
  "cep-cel": ["cep-cel/tflo_cep_wasm_bg.wasm", 320_000], // CEL patterns — `./cel`
  "ops-cel": ["ops-cel/tflo_wasm_bg.wasm", 500_000], // CEL rule eval — `./cel`
};

let failed = false;
console.log("── wasm size budget (gzip) ─────────────────────────────");
for (const [name, [rel, budget]] of Object.entries(BUDGETS)) {
  const path = join(wasmDir, rel);
  if (!existsSync(path)) {
    console.error(`  MISSING ${name} (${rel}) — run \`npm run build:wasm\` first`);
    failed = true;
    continue;
  }
  const gz = gzipSync(readFileSync(path)).length;
  const ok = gz <= budget;
  const pct = Math.round((gz / budget) * 100);
  console.log(
    `  ${ok ? "OK  " : "FAIL"} ${name.padEnd(8)} ${gz.toLocaleString().padStart(9)} B  / ${budget.toLocaleString()} B  (${pct}%)`,
  );
  if (!ok) failed = true;
}

if (failed) {
  console.error("\nwasm size budget exceeded — see above. Do NOT just raise the budget;");
  console.error("confirm no heavy dependency (CEL/regex/chrono) leaked into a lean artifact.");
  process.exit(1);
}
console.log("all artifacts within budget ✓");
