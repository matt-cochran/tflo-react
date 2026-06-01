/**
 * Runtime test for the per-step correlation pattern over the REAL WASM engine.
 *
 * Mirrors a real per-entity pattern: a `connection_failed` followed by a
 * `connection_succeeded` for the SAME `integrationId`. Two integrations are
 * interleaved on one stream; with `partitionBy: e => e.integrationId` each
 * integration gets its OWN partial-match state, so the pattern correlates WITHIN
 * an integration and never cross-correlates between interleaved ones.
 *
 * This is the exact shape that motivated the per-step `Match`/`MatchContext`
 * typing: `ctx.first()?.integrationId` and `m.first().integrationId` are read
 * with NO `"prop" in e` helper (see correlation.test-d.ts for the type spec).
 *
 * Emissions are observed via `ctx.signals.subscribeAll`, which delivers EVERY
 * published signal synchronously (the `useSignal` hook keeps only the latest, so
 * it would drop the first of two synchronous interleaved emits).
 */
import { act } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { createTflo } from "../../src/index";
import { renderWithTflo } from "../../src/testing/index";

type Events =
  | { kind: "connection_failed"; ts: number; integrationId: string; attemptId: string }
  | { kind: "connection_succeeded"; ts: number; integrationId: string; attemptId: string }
  | { kind: "activity"; ts: number; userId: string };

type Signals = {
  recovered: { integrationId: string };
};

const t = createTflo<Events, Signals>();

function RecoveredProbe({ onReady }: { onReady: (d: (e: Events) => void) => void }) {
  const dispatch = t.useEmit();
  onReady(dispatch);
  // recovered = connection_failed then connection_succeeded for the SAME
  // integrationId. partitionBy gives each integration its own matcher; ctx.first()
  // is the failed step (per-step typed) so we read its integrationId with no helper.
  t.usePattern(
    "recovered",
    (p) =>
      p
        .timestamp((e) => e.ts)
        .when((e) => e.kind === "connection_failed")
        .then(
          (e, ctx) =>
            e.kind === "connection_succeeded" && e.integrationId === ctx.first()?.integrationId,
        )
        .within(60_000)
        .emit((m) => ({ integrationId: m.first().integrationId })),
    [],
    { partitionBy: (e) => ("integrationId" in e ? e.integrationId : undefined) },
  );
  return <div data-testid="ready" />;
}

describe("typed correlation — per-entity recovery via MatchContext (real WASM)", () => {
  it("correlates fail→succeed within an integration, not across interleaved ones", async () => {
    let dispatch!: (e: Events) => void;
    const recovered: Array<{ integrationId: string }> = [];

    const { settle, ctx } = await renderWithTflo(
      <RecoveredProbe onReady={(d) => (dispatch = d)} />,
    );
    const unsub = ctx.signals.subscribeAll((name, sig) => {
      if (name === "recovered") recovered.push(sig.payload as { integrationId: string });
    });

    // Interleave two integrations: I1 fails, I2 fails, I2 succeeds, I1 succeeds.
    // An un-partitioned matcher would mis-correlate I1.fail with I2.succeed.
    act(() => {
      dispatch({ kind: "connection_failed", ts: 0, integrationId: "I1", attemptId: "a1" });
      dispatch({ kind: "connection_failed", ts: 100, integrationId: "I2", attemptId: "b1" });
      dispatch({ kind: "connection_succeeded", ts: 200, integrationId: "I2", attemptId: "b2" });
      dispatch({ kind: "connection_succeeded", ts: 300, integrationId: "I1", attemptId: "a2" });
    });
    await settle();
    unsub();

    const ids = recovered.map((r) => r.integrationId).sort();
    // Both integrations recovered, each correlated to its OWN id (no cross-talk).
    expect(new Set(ids)).toEqual(new Set(["I1", "I2"]));
  });

  it("does NOT fire when the succeed is for a different integration only", async () => {
    let dispatch!: (e: Events) => void;
    const recovered: Array<{ integrationId: string }> = [];

    const { settle, ctx } = await renderWithTflo(
      <RecoveredProbe onReady={(d) => (dispatch = d)} />,
    );
    const unsub = ctx.signals.subscribeAll((name, sig) => {
      if (name === "recovered") recovered.push(sig.payload as { integrationId: string });
    });

    act(() => {
      // I1 fails; only I2 succeeds (different integration) → no recovery for I1.
      dispatch({ kind: "connection_failed", ts: 0, integrationId: "I1", attemptId: "a1" });
      dispatch({ kind: "connection_succeeded", ts: 200, integrationId: "I2", attemptId: "b2" });
      dispatch({ kind: "activity", ts: 90_000, userId: "u1" }); // advance clock past window
    });
    await settle();
    unsub();

    expect(recovered).toHaveLength(0);
  });
});
