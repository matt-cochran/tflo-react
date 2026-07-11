/**
 * Schema types for the strongly-typed `tflo-react` facade (`createTflo<E, S>`).
 *
 * These are the contracts a consumer supplies to get full type safety:
 *  - `E` — a discriminated-union event type (each member has a `kind` + `ts`).
 *  - `S` — a `{ signalName: payloadType }` map.
 *
 * The runtime engine stays "soft" (`unknown`); these types live entirely at the
 * boundary. Nothing here changes the WASM ABI or the untyped runtime hooks.
 */

/** The minimal shape every user event must satisfy: a discriminant + timestamp. */
export type TfloEvent = { kind: string; ts: number };

/**
 * Constraint for a `{ signalName: payloadType }` map. This is ONLY a `S extends
 * SignalMap` bound — it never widens the consumer's actual `S` (that stays the
 * exact `type`/`interface` they pass), so `S[K]` payload inference is fully
 * preserved. Its job is to gate what is accepted as a signal schema.
 *
 * Why not `Record<string, unknown>`? An `interface` has no implicit string index
 * signature, so it is NOT assignable to `Record<string, unknown>` and was wrongly
 * rejected ("Index signature for type 'string' is missing"), forcing consumers to
 * use `type`. That was a false rejection, not extra safety.
 *
 * Why not bare `object`? `object` would also accept arrays and functions (both are
 * objects), which are nonsense as signal maps. So we keep the original constraint's
 * rejections (array / function / primitive) while ADDITIONALLY accepting interfaces:
 * the bound is `object` minus the array/function brands. An array's `length:
 * number` conflicts with `length?: never`; a function's `call`/`apply` conflict
 * with `call?: never`/`apply?: never`; a primitive isn't `object`. A plain keyed
 * `type` or `interface` satisfies it untouched.
 *
 * (Trade-off: a signal map with a key literally named `length`, `call`, or `apply`
 * would be rejected — implausible signal names, an acceptable price for keeping
 * arrays/functions out. Such a map can still use the untyped escape-hatch hooks.)
 */
export type SignalMap = object & { length?: never; call?: never; apply?: never };

/** A derived signal carrying a statically-typed payload. */
export interface TypedSignal<P> {
  name: string;
  ts: number;
  payload: P;
}
