/**
 * Schema types for the strongly-typed `@tflo/react` facade (`createTflo<E, S>`).
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

/** A `{ signalName: payloadType }` map. Soft constraint — the user supplies a precise map. */
export type SignalMap = Record<string, unknown>;

/** A derived signal carrying a statically-typed payload. */
export interface TypedSignal<P> {
  name: string;
  ts: number;
  payload: P;
}
