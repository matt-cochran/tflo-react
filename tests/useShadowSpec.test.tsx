import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { useShadowSpec, type ShadowSpec } from "../src/hooks/useShadowSpec";
import { type Pattern } from "../src/core/pattern";

interface Ev extends Record<string, unknown> {
  kind: string;
  flowId: string;
  ts: number;
}

// "Abandoned flow" = started, then NO completion within the window. The active
// and candidate specs differ ONLY in the window length, so a flow that completes
// at ts=2000 is abandoned under within=1000 (candidate, too tight) but NOT under
// within=5000 (active, in time). That is exactly the live divergence a shadow
// rollout must surface BEFORE the candidate ships.
const abandonedWithin =
  (name: string, within: number) =>
  (p: Pattern<Ev>) =>
    p
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "flow_started")
      .notThen((e) => e.kind === "flow_completed")
      .within(within)
      .emit((m) => ({ name: "abandoned", payload: { flowId: m.first().flowId } }));

const active: ShadowSpec<Ev> = { name: "within-5000", build: abandonedWithin("within-5000", 5000) };
const candidate: ShadowSpec<Ev> = {
  name: "within-1000",
  build: abandonedWithin("within-1000", 1000),
};

// SCENARIO 1 redux, LIVE: a flow A started at ts=0, completed at ts=2000 (slow).
// Under the active window (5000) it's in time → no signal. Under the candidate
// window (1000) it's too slow → abandoned. The candidate emits a signal the
// active never does → one candidate-side divergence.
const log: Ev[] = [
  { kind: "flow_started", flowId: "A", ts: 0 },
  { kind: "flow_completed", flowId: "A", ts: 2000 },
];

describe("useShadowSpec — live canary of a candidate rule against the active one", () => {
  it("surfaces the divergence the candidate emits but the active does not", async () => {
    let dispatch!: (e: Ev) => void;
    let shadow: ReturnType<typeof useShadowSpec<Ev>> = {
      activeSignals: [],
      candidateSignals: [],
      divergences: [],
    };

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      shadow = useShadowSpec<Ev>(active, candidate);
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    // Push the SAME live stream through both shadow runtimes.
    await act(async () => {
      for (const e of log) dispatch(e);
    });

    // The candidate's tight window abandons flow A; the active's loose window
    // does not. So the candidate emits exactly one signal the active never did.
    await waitFor(() => expect(shadow.divergences.length).toBe(1));

    // Active side acted on nothing; candidate observed one abandonment.
    expect(shadow.activeSignals).toHaveLength(0);
    expect(shadow.candidateSignals).toHaveLength(1);
    expect(shadow.candidateSignals[0].name).toBe("abandoned");

    // The single divergence is candidate-side, naming flow A.
    const d = shadow.divergences[0];
    expect(d.side).toBe("candidate");
    expect(d.signal.name).toBe("abandoned");
    expect(d.signal.payload.flowId).toBe("A");
  });

  it("reports NO divergence when active and candidate agree", async () => {
    let dispatch!: (e: Ev) => void;
    let shadow: ReturnType<typeof useShadowSpec<Ev>> = {
      activeSignals: [],
      candidateSignals: [],
      divergences: [],
    };

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      shadow = useShadowSpec<Ev>(active, candidate);
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    // A flow that completes FAST (ts=500) is in time under BOTH windows → neither
    // side emits → the specs agree → zero divergence.
    await act(async () => {
      dispatch({ kind: "flow_started", flowId: "B", ts: 0 });
      dispatch({ kind: "flow_completed", flowId: "B", ts: 500 });
    });

    // Give the runtimes a beat; nothing should have diverged.
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(shadow.divergences).toHaveLength(0);
    expect(shadow.activeSignals).toHaveLength(0);
    expect(shadow.candidateSignals).toHaveLength(0);
  });
});
