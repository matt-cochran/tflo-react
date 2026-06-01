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

// SignalMap is the soft record constraint.
expectTypeOf<SignalMap>().toEqualTypeOf<Record<string, unknown>>();

// Negative: payload is NOT a different shape.
// @ts-expect-error payload is {a:number}, not {b:string}
expectTypeOf<TypedSignal<{ a: number }>["payload"]>().toEqualTypeOf<{ b: string }>();
