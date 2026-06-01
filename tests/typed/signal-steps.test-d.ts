/**
 * Compile-time type tests for typed signal steps
 * (`whenSignal`/`thenSignal`/`notThenSignal`). Pass by compiling clean.
 * Negative cases are pinned with `@ts-expect-error` (tsc fails if they DON'T
 * error). The NON-NEGOTIABLE win pinned here: signal names are checked against
 * `keyof S` (typo-safe + autocomplete), and the captured signal's `payload` is
 * `S[name]` (reachable by narrowing the `Match` element on `kind`/`name`).
 */
import { expectTypeOf } from "expect-type";
import { Pattern } from "../../src/core/pattern";
import { createTflo, TypedPattern } from "../../src/index";

type Events =
  | { kind: "add_to_cart"; ts: number; cartId: string; sku: string }
  | { kind: "purchase"; ts: number; cartId: string };

type Signals = {
  abandoned_cart: { cartId: string };
  rage: { count: number };
  frustrated_session: {};
  // A non-empty layered signal — gives the emit-payload assertion sharper teeth.
  summary: { reason: string };
};

declare const raw: Pattern;
const tp = new TypedPattern<Events, Signals, "summary">(raw, "summary");

// ── Assertion 1: whenSignal name is checked against keyof Signals. ──
tp.whenSignal("rage"); // ok
// @ts-expect-error "not_a_signal" is not a key of Signals
tp.whenSignal("not_a_signal");

// thenSignal / notThenSignal are likewise name-checked.
// @ts-expect-error "nope" is not a key of Signals
tp.thenSignal("nope");
// @ts-expect-error "nope" is not a key of Signals
tp.notThenSignal("nope");

// ── Assertion 2: the captured signal's payload is S[name] (after narrow). ──
new TypedPattern<Events, Signals, "summary">(raw, "summary")
  .whenSignal("rage")
  .emit((m) => {
    const e = m.first();
    if (e.kind === "signal" && e.name === "rage") {
      // payload narrows to Signals["rage"] = { count: number }
      expectTypeOf(e.payload).toEqualTypeOf<{ count: number }>();
      const n: number = e.payload.count;
      void n;
    }
    return { reason: "x" };
  });

// ── Assertion 3: layered pattern via the createTflo facade compiles. ──
const t = createTflo<Events, Signals>();

t.usePattern("frustrated_session", (p) =>
  p.whenSignal("rage").thenSignal("abandoned_cart").within(60_000).emit(() => ({})),
);

// ── Assertion 4: emit payload must satisfy the OWN signal's payload type. ──
// `summary` requires { reason: string }, so a wrong payload is a compile error.
t.usePattern("summary", (p) =>
  p
    .whenSignal("rage")
    .thenSignal("abandoned_cart")
    .within(60_000)
    // @ts-expect-error payload must satisfy Signals["summary"] = { reason: string }
    .emit(() => ({ wrong: 1 })),
);

// Correct payload for `summary` is accepted, and can be derived from a captured
// signal's typed payload.
t.usePattern("summary", (p) =>
  p
    .whenSignal("rage")
    .within(60_000)
    .emit((m) => {
      const e = m.first();
      const reason = e.kind === "signal" && e.name === "rage" ? `rage x${e.payload.count}` : "n/a";
      return { reason };
    }),
);
