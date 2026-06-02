/**
 * Compile-time type tests for the typed CEL bridge `compileTypedCelPattern<E,S>`.
 * The CEL strings stay opaque, but the signal `name` (∈ keyof S) and the emitted
 * `payload` (∈ S[K]) ARE schema-checked — the statically-knowable surface.
 */
import { compileTypedCelPattern } from "../../src/cel/index";

interface Ev {
  kind: string;
  productId: string;
  ts: number;
}

type Signals = {
  engaged: { productId: string };
  bounced: { reason: string };
};

// ── ok: name ∈ keyof S, payload satisfies S["engaged"] ──────────────────────
compileTypedCelPattern<Ev, Signals, "engaged">(
  { name: "engaged", when: 'kind == "view"', then: ['kind == "scroll"'] },
  (e) => e.ts,
  (m) => ({ productId: m.first().productId }),
);

// ── error: payload shape doesn't match S["engaged"] (missing productId) ─────
compileTypedCelPattern<Ev, Signals, "engaged">(
  { name: "engaged", when: 'kind == "view"' },
  (e) => e.ts,
  // @ts-expect-error — { wrong: number } is not assignable to { productId: string }
  () => ({ wrong: 1 }),
);

// ── error: name not in keyof S ──────────────────────────────────────────────
compileTypedCelPattern<Ev, Signals, "engaged">(
  // @ts-expect-error — "nope" is not a key of Signals
  { name: "nope", when: 'kind == "view"' },
  (e) => e.ts,
  (m) => ({ productId: m.first().productId }),
);
