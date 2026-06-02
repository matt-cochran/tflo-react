import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { Pattern } from "../src/core/pattern";
import { CauseRef, TraceStore, causesFrom } from "../src/core/provenance";
import { useExplain } from "../src/hooks/useExplain";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

describe("TraceStore.explain (pure)", () => {
  it("walks `causes` recursively into a nested tree", () => {
    const store = new TraceStore();
    // A raw event, a fact signal caused by it, a journey signal caused by the fact.
    store.recordSignal("IntegrationBlocked", 100, [
      { kind: "event", name: "connection_failed", ts: 10 },
    ]);
    store.recordSignal("DeveloperBlocked", 200, [
      { kind: "signal", name: "IntegrationBlocked", ts: 100 },
    ]);

    const tree = store.explain("DeveloperBlocked", 200);
    expect(tree.name).toBe("DeveloperBlocked");
    expect(tree.kind).toBe("signal");
    expect(tree.children).toHaveLength(1);
    const fact = tree.children[0];
    expect(fact.name).toBe("IntegrationBlocked");
    expect(fact.kind).toBe("signal");
    expect(fact.children).toHaveLength(1);
    expect(fact.children[0]).toEqual({
      name: "connection_failed",
      ts: 10,
      kind: "event",
      children: [],
    });
  });
});

describe("causesFrom helper", () => {
  it("maps matched raw events to event CauseRefs", () => {
    const causes: CauseRef[] = causesFrom([
      { kind: "click", ts: 1 },
      { kind: "click", ts: 2 },
    ]);
    expect(causes).toEqual([
      { kind: "event", name: "click", ts: 1 },
      { kind: "event", name: "click", ts: 2 },
    ]);
  });

  it("maps re-entered signals to signal CauseRefs", () => {
    const causes = causesFrom([
      { kind: "signal", name: "IntegrationBlocked", ts: 100, payload: {} },
    ]);
    expect(causes).toEqual([{ kind: "signal", name: "IntegrationBlocked", ts: 100 }]);
  });
});

describe("provider trace integration", () => {
  it("records signal provenance and exposes it via useExplain", async () => {
    let dispatch!: (e: Ev) => void;
    let explainTree: ReturnType<typeof useExplain> = undefined;
    let traceStore: TraceStore | undefined;

    function Probe() {
      const ctx = useTfloContext();
      traceStore = ctx.trace;
      dispatch = useEmit() as (e: Ev) => void;
      const rdy = ctx.ready;

      // fact: a connection_failed produces IntegrationBlocked, feeding it back.
      usePattern(
        "IntegrationBlocked",
        (p: Pattern<Ev>) =>
          p
            .timestamp((e) => e.ts)
            .when((e) => e.kind === "connection_failed")
            .emit((m) => ({ name: "IntegrationBlocked", payload: { causes: causesFrom(m.all()) } })),
        [],
        { kinds: ["connection_failed"], feedback: true },
      );

      // journey: IntegrationBlocked signal produces DeveloperBlocked.
      usePattern(
        "DeveloperBlocked",
        (p: Pattern<Ev>) =>
          p
            .timestamp((e) => e.ts)
            .when((e) => e.kind === "signal" && (e as { name?: unknown }).name === "IntegrationBlocked")
            .emit((m) => ({ name: "DeveloperBlocked", payload: { causes: causesFrom(m.all()) } })),
        [],
      );

      explainTree = useExplain("DeveloperBlocked");
      return <div data-testid="ready">{String(rdy)}</div>;
    }

    render(
      <TfloProvider trace>
        <Probe />
      </TfloProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(traceStore).toBeInstanceOf(TraceStore);

    await act(async () => {
      dispatch({ kind: "connection_failed", ts: 10 });
    });

    await waitFor(() => expect(explainTree?.name).toBe("DeveloperBlocked"));
    // The journey traces back through the fact signal to the raw event.
    expect(explainTree?.children[0]?.name).toBe("IntegrationBlocked");
    expect(explainTree?.children[0]?.children[0]).toMatchObject({
      name: "connection_failed",
      kind: "event",
    });
  });

  it("leaves trace undefined when the provider opts out", async () => {
    let traceStore: TraceStore | undefined = new TraceStore();
    function Probe() {
      const ctx = useTfloContext();
      traceStore = ctx.trace;
      return <div data-testid="ready">{String(ctx.ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(traceStore).toBeUndefined();
  });
});
