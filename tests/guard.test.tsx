import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignal } from "../src/hooks/useSignal";
import { useProjection, guard } from "../src/hooks/useProjection";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
  integrationId?: string;
  status?: string;
}

// Part A / #4: a RELATIONAL GUARD — a pattern reads ANOTHER entity's current
// derived state to decide a match ("block I2's activation while I1 is blocked").
// The guard reads a deterministic projection, so it's replay-safe; the verdict
// is emitted as a derived event.
describe("relational guard reading another entity's projection (#4)", () => {
  function harness() {
    let dispatch!: (e: Ev) => void;
    const fired: number[] = [];

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      // Derived status per integration (folded from `status` events).
      const status = useProjection<Ev, string, string>(
        (e) => e.integrationId ?? "?",
        (_prev, e) => e.status ?? "ok",
        { kind: "status" },
      );
      // "I2 activation blocked WHILE I1 is blocked" — a guard over I1's state.
      usePattern<Ev>(
        "I2Blocked",
        (p) =>
          p
            .timestamp((e) => e.ts)
            .when(
              guard(status, (e, s) => e.integrationId === "I2" && s.get("I1") === "blocked"),
            )
            .emit((m) => ({ name: "I2Blocked", ts: m.first().ts, payload: {} })),
        [],
        { kinds: ["activate"] },
      );
      const sig = useSignal("I2Blocked");
      if (sig) fired.push(sig.ts);
      return <div data-testid="ready">{String(ready)}</div>;
    }

    return { Probe, getDispatch: () => dispatch, fired };
  }

  it("fires the verdict only while the peer (I1) is blocked", async () => {
    const { Probe, getDispatch, fired } = harness();
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    const dispatch = getDispatch();

    await act(async () => {
      dispatch({ kind: "status", ts: 0, integrationId: "I1", status: "blocked" });
      dispatch({ kind: "activate", ts: 1, integrationId: "I2" }); // I1 blocked → verdict fires
    });
    await waitFor(() => expect(fired).toContain(1));

    await act(async () => {
      dispatch({ kind: "status", ts: 2, integrationId: "I1", status: "ok" });
      dispatch({ kind: "activate", ts: 3, integrationId: "I2" }); // I1 ok → no verdict
    });
    // ts=3 must NOT fire (peer recovered): the latest verdict ts is still 1.
    expect(fired[fired.length - 1]).toBe(1);
  });

  it("is deterministic — identical streams yield identical verdicts", async () => {
    const runOnce = async () => {
      const { Probe, getDispatch, fired } = harness();
      const { unmount } = render(
        <TfloProvider>
          <Probe />
        </TfloProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
      const dispatch = getDispatch();
      await act(async () => {
        dispatch({ kind: "status", ts: 0, integrationId: "I1", status: "blocked" });
        dispatch({ kind: "activate", ts: 1, integrationId: "I2" });
        dispatch({ kind: "status", ts: 2, integrationId: "I1", status: "ok" });
        dispatch({ kind: "activate", ts: 3, integrationId: "I2" });
      });
      await waitFor(() => expect(fired.length).toBeGreaterThan(0));
      const result = [...new Set(fired)];
      unmount();
      return result;
    };

    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual(b);
    expect(a).toEqual([1]); // exactly one verdict, at ts=1, both runs
  });
});
