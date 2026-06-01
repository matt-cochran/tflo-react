/**
 * Compile-time spec for the CORE friction fixes (Friction 1 + 2): per-step
 * `Match`/`MatchContext` narrowing via an accumulated step tuple, and `.emit`'s
 * match INFERRED from the chain (no hand annotation).
 *
 * The bread-and-butter correlation pattern must typecheck with NO `"prop" in e`
 * helpers: `ctx.first()?.integrationId` and `m.first().<step-0 field>` resolve
 * directly because each step's captured variant is tracked in the tuple.
 *
 * Negative cases pinned with `@ts-expect-error` (tsc fails if they DON'T error).
 */
import { expectTypeOf } from "expect-type";
import { createTflo } from "../../src/index";

// Sample union with PER-VARIANT fields (mirrors the demo's connection lifecycle).
type ConnFailed = {
  kind: "connection_failed";
  ts: number;
  integrationId: string;
  attemptId: string;
};
type ConnSucceeded = {
  kind: "connection_succeeded";
  ts: number;
  integrationId: string;
  attemptId: string;
};
type Events =
  | ConnFailed
  | ConnSucceeded
  | { kind: "docs_opened"; ts: number; integrationId: string }
  | { kind: "activity"; ts: number; userId: string };

type Signals = {
  recovered: { integrationId: string };
};

const t = createTflo<Events, Signals>();

// ── Friction 1: the correlation pattern compiles with NO helpers. ──
// step 0 is `connection_failed`; in `.then`, `ctx.first()` is the
// `connection_failed` variant, so `ctx.first()?.integrationId` is valid.
t.usePattern("recovered", (p) =>
  p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "connection_failed")
    .then((e, ctx) => {
      // ctx.first() is the connection_failed variant (has integrationId).
      expectTypeOf(ctx.first()).toEqualTypeOf<ConnFailed | undefined>();
      const firstId: string | undefined = ctx.first()?.integrationId;
      void firstId;
      return e.kind === "connection_succeeded" && e.integrationId === ctx.first()?.integrationId;
    })
    .within(60_000)
    // ── Friction 2: `m` is INFERRED — no `(m: Match<...>)` annotation. ──
    .emit((m) => {
      // m.first() is step 0 (connection_failed): integrationId reads directly.
      expectTypeOf(m.first()).toEqualTypeOf<ConnFailed>();
      const id: string = m.first().integrationId;
      return { integrationId: id };
    }),
);

// ── Friction 1/2: emit m.first() typed to step 0, m.last() to the last step.
// Use clean guard steps so both ends are narrowed.
t.usePattern("recovered", (p) =>
  p
    .when((e) => e.kind === "connection_failed")
    .then((e) => e.kind === "connection_succeeded")
    .within(60_000)
    .emit((m) => {
      // first() is step 0 = connection_failed
      expectTypeOf(m.first()).toEqualTypeOf<ConnFailed>();
      // last() is the final step = connection_succeeded
      expectTypeOf(m.last()).toEqualTypeOf<ConnSucceeded>();
      // reading a field present on step-0's variant compiles
      const ok: string = m.first().integrationId;
      void ok;
      // @ts-expect-error step 0 is connection_failed, which has no `userId`
      void m.first().userId;
      return { integrationId: m.first().integrationId };
    }),
);

// ── Fallback: a predicate the compiler cannot prove is a guard appends the full
//    union for that step (safe, lossless). Reading a per-variant field then needs
//    a narrow — exactly the pre-fix ergonomic, only for non-guard predicates.
t.usePattern("recovered", (p) =>
  p
    .when((e) => e.ts > 0) // not a type guard → step 0 is the full Events union
    .emit((m) => {
      expectTypeOf(m.first()).toEqualTypeOf<Events>();
      // @ts-expect-error integrationId is not on every member of the union
      void m.first().integrationId;
      return { integrationId: "x" };
    }),
);
