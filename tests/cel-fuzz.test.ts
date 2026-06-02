import { beforeAll, describe, expect, it } from "vitest";
import { CelPattern, CelRuntime, initTfloCel } from "../src/cel/index";
import type { DerivedSignal } from "../src/core/pattern";

beforeAll(async () => {
  await initTfloCel();
});

/**
 * A WASM panic becomes an uncatchable `unreachable`/`memory access out of
 * bounds` trap that POISONS the whole module instance — every later call fails
 * too. The parser is recursive-descent, so a deeply-nested expression overflows
 * the native stack. We guard against that (length + nesting caps, see
 * `validate_cel` in tflo-cep-wasm) so malformed input always surfaces as a
 * catchable JS error and the instance stays alive.
 */

// The full hostile barrage — every one must be SURVIVABLE (catchable error or a
// usable pattern), never an instance-poisoning trap. Some are lenient-but-valid
// CEL (e.g. ". kind"); that's fine, the point is no trap.
const HOSTILE: string[] = [
  "",
  "   ",
  "kind ===",
  "kind ==",
  "== kind",
  "&&",
  "kind &&",
  "(",
  ")",
  "((((kind",
  "kind))))",
  '"unterminated',
  "1 +",
  "+ 1",
  "kind == 'a' ??",
  "@#$%^&*",
  "kind in",
  "[1, 2,",
  "{ 'a':",
  "?:",
  "kind .",
  ". kind",
  "kind[",
  "🔥 == 🔥🔥",
  // pathological nesting / size — the cases that trapped before the guard.
  `${"(".repeat(5000)}kind${")".repeat(5000)}`,
  `${"!".repeat(5000)}kind`,
  "kind".repeat(50000),
];

// Inputs the guard or parser must REJECT with a catchable error (definitely
// invalid OR over the safety caps).
const MUST_THROW: string[] = [
  "kind ===",
  "((((kind",
  '"unterminated',
  "1 +",
  // over the length cap (1024) → rejected before the parser.
  `${"(".repeat(5000)}kind${")".repeat(5000)}`,
  `${"!".repeat(5000)}kind`,
  "kind".repeat(50000),
  // over the nesting-depth cap (32), but UNDER the length cap — proves the
  // depth guard fires independently of length.
  `${"(".repeat(40)}kind${")".repeat(40)}`,
  `${"!".repeat(40)}kind`,
];

describe("CEL never panics on malformed input (wasm trap safety)", () => {
  it("rejects definitely-invalid / oversized expressions with a catchable error", () => {
    for (const expr of MUST_THROW) {
      expect(
        () => new CelPattern("fuzz").whenCel(expr),
        `expr: ${JSON.stringify(expr).slice(0, 40)}`,
      ).toThrow();
    }
  });

  it("the wasm instance survives the whole hostile barrage (no poisoning trap)", () => {
    for (const expr of HOSTILE) {
      try {
        new CelPattern("fuzz").whenCel(expr);
      } catch {
        /* expected for many — we only care that it didn't trap the instance */
      }
    }

    // Proof of life: a good pattern still compiles AND runs after the barrage.
    interface Ev {
      kind: string;
      ts: number;
    }
    const compiled = new CelPattern<Ev>("ok")
      .timestamp((e) => e.ts)
      .whenCel('kind == "go"')
      .emit(() => ({ name: "ok", payload: {} }));
    const rt = new CelRuntime(compiled);
    const out: DerivedSignal[] = [];
    out.push(...rt.push({ kind: "go", ts: 0 }));
    out.push(...rt.flush());
    rt.destroy();
    expect(out).toHaveLength(1);
  });

  it("a legitimately deep (but bounded) binary chain compiles without trapping", () => {
    interface Ev {
      kind: string;
      ts: number;
    }
    // ~340 chained additions, well under the length cap — proves the guard
    // leaves real margin below the native-stack overflow threshold. Binary
    // chains aren't caught by the nesting-depth counter, only by the length cap,
    // so this is the case that validates the cap is conservative enough.
    const deepButValid = `1${"+1".repeat(340)} == 341`;
    const compiled = new CelPattern<Ev>("deep")
      .timestamp((e) => e.ts)
      .whenCel(deepButValid)
      .emit(() => ({ name: "deep", payload: {} }));
    const rt = new CelRuntime(compiled);
    const out: DerivedSignal[] = [];
    out.push(...rt.push({ kind: "x", ts: 0 }));
    out.push(...rt.flush());
    rt.destroy();
    expect(out).toHaveLength(1); // 1+1+...+1 (341 ones) == 341 → true → matches
  });

  it("valid expressions that error at runtime evaluate to false without trapping", () => {
    interface Ev {
      kind: string;
      ts: number;
    }
    // Undefined variable + division by zero are RUNTIME errors (compile fine);
    // they must degrade to a non-match, never a trap.
    for (const expr of ["missingVar == 1", "1 / 0 == 0", "kind.size() > 9999"]) {
      const compiled = new CelPattern<Ev>("rt")
        .timestamp((e) => e.ts)
        .whenCel(expr)
        .emit(() => ({ name: "rt", payload: {} }));
      const rt = new CelRuntime(compiled);
      const out: DerivedSignal[] = [];
      out.push(...rt.push({ kind: "x", ts: 0 }));
      out.push(...rt.flush());
      rt.destroy();
      expect(out, `expr: ${expr}`).toHaveLength(0);
    }
  });
});
