/**
 * Compile-time type tests for `TypedPattern`. Pass by compiling clean.
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
const tp = new TypedPattern<Events, Signals, "abandoned_cart">(raw, "abandoned_cart");

// Assertion 2: inside `.when`, after a discriminant narrow, `e.sku` is `string`.
tp.when((e) => {
  if (e.kind === "add_to_cart") {
    expectTypeOf(e.sku).toEqualTypeOf<string>();
    expectTypeOf(e.cartId).toEqualTypeOf<string>();
    return true;
  }
  // purchase member has no `sku`
  // @ts-expect-error `sku` does not exist on the purchase member
  return e.sku === "x";
});

// `.then` receives the typed event + MatchContext<Events>.
tp.then((e, ctx) => {
  expectTypeOf(e).toEqualTypeOf<Events>();
  expectTypeOf(ctx.first()).toEqualTypeOf<Events | undefined>();
  return true;
});

// Assertion 3a: emit returning the correct payload shape is accepted.
tp.emit((m) => {
  const first = m.first();
  expectTypeOf(first).toEqualTypeOf<Events>();
  return { cartId: first.kind === "add_to_cart" ? first.cartId : "" };
});

// Assertion 3b: emit returning the WRONG payload is a compile error.
// @ts-expect-error payload must satisfy Signals["abandoned_cart"] = { cartId: string }
tp.emit(() => ({ wrong: 1 }));
