/**
 * Cross-tier parity keystone (browser half).
 *
 * Runs the SAME golden vectors as the native Rust test
 * (`tflo/tflo-cep/tests/parity/vectors.json`) through the wasm CEL engine and
 * asserts the same `expected` output. Green here + green in `cargo test
 * parity_vectors` ⇒ the native and browser engines produce byte-identical
 * signals for a serialized CEL pattern spec. Single source of truth: we read
 * the Rust crate's vectors file directly (sibling repo at ../../tflo).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  initTfloCel,
  compileCelPattern,
  CelRuntime,
  type CelPatternSpec,
} from "../src/cel/index";

interface Case {
  name: string;
  spec: CelPatternSpec;
  events: { ts: number }[];
  expected: number[];
}

// vitest runs with cwd = the tflo-react package root; the tflo engine repo is a
// sibling. Read the Rust crate's vectors file directly (single source of truth).
const vectorsPath = join(process.cwd(), "../tflo/tflo-cep/tests/parity/vectors.json");
const VECTORS = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
  cases: Case[];
};

beforeAll(async () => {
  await initTfloCel();
});

describe("cross-tier parity — same golden vectors as native tflo-cep", () => {
  it("loaded the shared vectors", () => {
    expect(VECTORS.cases.length).toBeGreaterThan(0);
  });

  for (const c of VECTORS.cases) {
    it(`case ${c.name} matches expected on the wasm engine`, () => {
      // Reduce each fired signal to the last matched event's ts — the same
      // language-agnostic token the native test compares.
      const compiled = compileCelPattern<{ ts: number }>(
        c.spec,
        (e) => e.ts,
        (m) => ({ name: c.spec.name, ts: m.last().ts, payload: {} }),
      );
      const rt = new CelRuntime(compiled);
      const out: number[] = [];
      for (const e of c.events) out.push(...rt.push(e).map((s) => s.ts));
      out.push(...rt.flush().map((s) => s.ts));
      rt.destroy();
      expect(out).toEqual(c.expected);
    });
  }
});
