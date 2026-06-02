/**
 * Compile-time type tests for the schema types. These "pass" by compiling
 * clean — a wrong assertion is a `tsc` error. Run via `npm run typecheck:types`.
 */
import { expectTypeOf } from "expect-type";
import type { TfloEvent, SignalMap, TypedSignal } from "../../src/typed/types";

// TypedSignal carries the payload type exactly.
expectTypeOf<TypedSignal<{ a: number }>["payload"]>().toEqualTypeOf<{ a: number }>();
expectTypeOf<TypedSignal<{ a: number }>>().toMatchTypeOf<{ name: string; ts: number }>();

// TfloEvent is the discriminant + timestamp floor.
expectTypeOf<TfloEvent>().toEqualTypeOf<{ kind: string; ts: number }>();

// SignalMap is `object` MINUS the array/function brands: it accepts keyed
// object maps (type OR interface) but keeps rejecting arrays/functions/primitives
// (see Friction 3). It is more precise than bare `object` and fixes the interface
// bug vs `Record<string, unknown>`.
expectTypeOf<SignalMap>().toEqualTypeOf<object & { length?: never; call?: never; apply?: never }>();

// Friction 3: an `interface` (no implicit string index signature) satisfies
// SignalMap. `Record<string, unknown>` would have rejected it.
interface IfaceSignals {
  rage: { count: number };
  abandoned_cart: { cartId: string };
}
expectTypeOf<IfaceSignals>().toMatchTypeOf<SignalMap>();
// And a plain object-literal type still satisfies it.
expectTypeOf<{ rage: { count: number } }>().toMatchTypeOf<SignalMap>();
// But arrays, functions, and primitives are still NOT signal maps.
// @ts-expect-error an array is not a valid signal map
expectTypeOf<number[]>().toMatchTypeOf<SignalMap>();
// @ts-expect-error a function is not a valid signal map
expectTypeOf<() => void>().toMatchTypeOf<SignalMap>();
// @ts-expect-error a primitive is not a valid signal map
expectTypeOf<number>().toMatchTypeOf<SignalMap>();

// Negative: payload is NOT a different shape.
// @ts-expect-error payload is {a:number}, not {b:string}
expectTypeOf<TypedSignal<{ a: number }>["payload"]>().toEqualTypeOf<{ b: string }>();
