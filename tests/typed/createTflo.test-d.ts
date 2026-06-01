/**
 * Compile-time type tests for `createTflo<E, S>()`. Pass by compiling clean.
 * Negative cases are pinned with `@ts-expect-error` (tsc fails if they DON'T
 * error). These encode the full type-safety acceptance criteria.
 */
import { expectTypeOf } from "expect-type";
import { createTflo, type TypedSignal } from "../../src/index";

type Events =
  | { kind: "add_to_cart"; ts: number; cartId: string; sku: string }
  | { kind: "purchase"; ts: number; cartId: string };

type Signals = {
  abandoned_cart: { cartId: string };
  rage: { count: number };
  frustrated_session: {};
};

const t = createTflo<Events, Signals>();

// ── Assertion 1: useEmit is (e: Events) => void; missing field is an error. ──
const dispatch = t.useEmit();
expectTypeOf(dispatch).toEqualTypeOf<(e: Events) => void>();
dispatch({ kind: "add_to_cart", ts: 1, cartId: "c1", sku: "s1" }); // ok
dispatch({ kind: "purchase", ts: 2, cartId: "c1" }); // ok
// @ts-expect-error missing required `sku`
dispatch({ kind: "add_to_cart", ts: 1, cartId: "c1" });
// @ts-expect-error unknown kind
dispatch({ kind: "nope", ts: 1 });

// ── Assertion 2: inside usePattern, after narrow, e.sku is string. ──
t.usePattern("abandoned_cart", (p) =>
  p
    .timestamp((e) => e.ts)
    .when((e) => {
      if (e.kind === "add_to_cart") {
        expectTypeOf(e.sku).toEqualTypeOf<string>();
        return true;
      }
      return false;
    })
    .notThen((e) => e.kind === "purchase")
    .within(1000)
    // ── Assertion 3a: correct payload accepted. ──
    .emit((m) => ({ cartId: m.first().kind === "add_to_cart" ? "x" : "y" })),
);

// ── Assertion 3b: wrong payload is a compile error. ──
t.usePattern("abandoned_cart", (p) =>
  p
    .when((e) => e.kind === "add_to_cart")
    // @ts-expect-error payload must satisfy Signals["abandoned_cart"] = { cartId: string }
    .emit(() => ({ wrong: 1 })),
);

// ── Assertion 4: a name not in keyof Signals is a compile error. ──
t.usePattern(
  // @ts-expect-error "not_a_signal" is not a key of Signals
  "not_a_signal",
  (p) => p.when((e) => e.kind === "add_to_cart").emit(() => ({}) as never),
);

// ── Assertion 5: useSignal is TypedSignal<{cartId:string}> | undefined. ──
const sig = t.useSignal("abandoned_cart");
expectTypeOf(sig).toEqualTypeOf<TypedSignal<{ cartId: string }> | undefined>();
// @ts-expect-error name must be a key of Signals
t.useSignal("not_a_signal");

// ── Assertion 6: useSignalCallback payload is typed. ──
t.useSignalCallback("rage", (s) => {
  const n: number = s.payload.count;
  expectTypeOf(s.payload).toEqualTypeOf<{ count: number }>();
  void n;
});
// @ts-expect-error name must be a key of Signals
t.useSignalCallback("not_a_signal", () => {});

// Bonus: usePattern returns the typed signal.
const r = t.usePattern("rage", (p) =>
  p.when((e) => e.kind === "add_to_cart").emit(() => ({ count: 1 })),
);
expectTypeOf(r).toEqualTypeOf<TypedSignal<{ count: number }> | undefined>();
