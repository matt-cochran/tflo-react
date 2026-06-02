/**
 * Compile-time spec for Friction 4: the untyped escape-hatch hooks
 * (`useEmit`/`useWindow`/`useCount`/`useJoin`) accept a STRICT discriminated
 * union — no `extends Record<string, unknown>` required. The constraint is now
 * `{ kind?: string; ts?: number }`, which a union member satisfies but which is
 * NOT weakened (a missing required field is still a compile error).
 *
 * Negative cases pinned with `@ts-expect-error` (tsc fails if they DON'T error).
 */
import { useEmit } from "../../src/hooks/useEmit";
import { useWindow, useCount } from "../../src/hooks/useWindow";
import { useJoin } from "../../src/hooks/useJoin";

// A clean discriminated union with per-variant fields — NO index signature.
type Ev =
  | { kind: "click"; ts: number; x: number }
  | { kind: "scroll"; ts: number; y: number };

declare function harness(): void;
function _Probe() {
  const dispatch = useEmit<Ev>();
  dispatch({ kind: "click", ts: 1, x: 2 }); // ok — strict union accepted
  dispatch({ kind: "scroll", ts: 1, y: 3 }); // ok
  // @ts-expect-error missing required field `x` (constraint not weakened)
  dispatch({ kind: "click", ts: 1 });
  // @ts-expect-error unknown discriminant
  dispatch({ kind: "nope", ts: 1 });

  // useWindow/useCount accept the strict union too.
  const w = useWindow<Ev>("click", { ms: 1000 });
  const c = useCount("click", { ms: 1000 });

  // useJoin accepts strict unions for both sides.
  const j = useJoin<Ev, Ev>([], [], { key: "kind", ts: "ts", window: 1000 });

  void w;
  void c;
  void j;
}
void _Probe;
void harness;
