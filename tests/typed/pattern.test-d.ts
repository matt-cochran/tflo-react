/**
 * Compile-time type tests for `TypedPattern`. Pass by compiling clean.
 *
 * These encode the PER-STEP `Match`/`MatchContext` typing (the accumulated step
 * tuple): `ctx.first()` is the first step's narrowed variant, `m.first()`/
 * `m.last()` are step 0 / the final step. Negative cases are pinned with
 * `@ts-expect-error` (tsc fails if they DON'T error).
 */
import { expectTypeOf } from "expect-type";
import { Pattern } from "../../src/core/pattern";
import { TypedPattern } from "../../src/typed/pattern";

type Events =
  | { kind: "add_to_cart"; ts: number; cartId: string; sku: string }
  | { kind: "purchase"; ts: number; cartId: string };

type Signals = {
  abandoned_cart: { cartId: string };
};

declare const raw: Pattern;

// ── Assertion 2: inside `.when`, after a discriminant narrow, `e.sku` is string.
new TypedPattern<Events, Signals, "abandoned_cart">(raw, "abandoned_cart").when((e) => {
  if (e.kind === "add_to_cart") {
    expectTypeOf(e.sku).toEqualTypeOf<string>();
    expectTypeOf(e.cartId).toEqualTypeOf<string>();
    return true;
  }
  // purchase member has no `sku`
  // @ts-expect-error `sku` does not exist on the purchase member
  return e.sku === "x";
});

// ── Per-step MatchContext: after `.when(add_to_cart)`, the `.then` predicate's
//    `ctx.first()` is the `add_to_cart` variant (step 0), NOT the full union.
new TypedPattern<Events, Signals, "abandoned_cart">(raw, "abandoned_cart")
  .when((e) => e.kind === "add_to_cart")
  .then((e, ctx) => {
    // current event is still the full union until narrowed
    expectTypeOf(e).toEqualTypeOf<Events>();
    // step 0 captured as add_to_cart → ctx.first() has cartId/sku
    expectTypeOf(ctx.first()).toEqualTypeOf<
      { kind: "add_to_cart"; ts: number; cartId: string; sku: string } | undefined
    >();
    return e.kind === "purchase" && e.cartId === ctx.first()?.cartId;
  });

// ── Assertion 3a: emit `m.first()` is the FIRST step's narrowed variant. ──
new TypedPattern<Events, Signals, "abandoned_cart">(raw, "abandoned_cart")
  .when((e) => e.kind === "add_to_cart")
  .emit((m) => {
    const first = m.first();
    expectTypeOf(first).toEqualTypeOf<{
      kind: "add_to_cart";
      ts: number;
      cartId: string;
      sku: string;
    }>();
    // step-0 field reads directly — no `"prop" in e` helper, no re-narrow.
    return { cartId: first.cartId };
  });

// ── Assertion 3b: emit returning the WRONG payload is a compile error. ──
new TypedPattern<Events, Signals, "abandoned_cart">(raw, "abandoned_cart")
  .when((e) => e.kind === "add_to_cart")
  // @ts-expect-error payload must satisfy Signals["abandoned_cart"] = { cartId: string }
  .emit(() => ({ wrong: 1 }));

// ── notBetween is a modifier on the UPCOMING step (interior-negation guard), so
//    it leaves the step tuple unchanged and stays chainable — `ctx.first()` in
//    the subsequent `.then` is still step 0's narrowed variant, and `m.first()`
//    in `.emit` is unchanged. (Same `this`-returning shape as next/within/times.)
const _afterNotBetween = new TypedPattern<Events, Signals, "abandoned_cart">(
  raw,
  "abandoned_cart",
)
  .when((e) => e.kind === "add_to_cart")
  .notBetween((e) => e.kind === "purchase");
expectTypeOf(_afterNotBetween).toEqualTypeOf<
  TypedPattern<Events, Signals, "abandoned_cart", [Extract<Events, { kind: "add_to_cart" }>]>
>();
_afterNotBetween.then((e, ctx) => {
  // tuple unchanged: ctx.first() is still the add_to_cart step (step 0)
  expectTypeOf(ctx.first()).toEqualTypeOf<
    { kind: "add_to_cart"; ts: number; cartId: string; sku: string } | undefined
  >();
  return e.kind === "purchase";
});
