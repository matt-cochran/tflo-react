/**
 * Runtime test for typed signal steps over the REAL WASM engine: a fact pattern
 * emits a signal with `feedback:true`; a higher-order pattern uses `whenSignal`
 * to fire when that fact signal re-enters the bus (the `{kind:"signal",...}`
 * cross-layer contract). Mirrors how the demo layers facts -> journeys.
 */
import { act } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { createTflo } from "../../src/index";
import { renderWithTflo } from "../../src/testing/index";

type Events =
  | { kind: "rage_click"; ts: number; sessionId: string }
  | { kind: "scroll"; ts: number; sessionId: string };

type Signals = {
  // Fact: emitted from raw events; re-entered (feedback) for higher layers.
  Rage: { sessionId: string };
  // Higher-order: fires when the Rage fact re-enters.
  FrustratedSession: { sessionId: string };
};

const t = createTflo<Events, Signals>();

describe("typed signal steps — layered CEP via whenSignal", () => {
  it("fires the higher-order signal when the fact signal re-enters (feedback)", async () => {
    let dispatch!: (e: Events) => void;
    const frustrated: Array<{ sessionId: string }> = [];

    function Probe() {
      dispatch = t.useEmit();

      // Fact layer: a rage_click -> Rage. feedback:true re-dispatches Rage as
      // an event so the higher layer can consume it.
      t.usePattern(
        "Rage",
        (p) =>
          p
            .timestamp((e) => e.ts)
            .when((e) => e.kind === "rage_click")
            .emit((m) => {
              const first = m.first();
              return { sessionId: first.kind === "rage_click" ? first.sessionId : "" };
            }),
        [],
        { feedback: true },
      );

      // Higher-order layer: consume the re-entered Rage signal via whenSignal.
      t.usePattern("FrustratedSession", (p) =>
        p
          .timestamp((e) => e.ts)
          .whenSignal("Rage")
          .emit((m) => {
            const e = m.first();
            const sessionId = e.kind === "signal" && e.name === "Rage" ? e.payload.sessionId : "";
            return { sessionId };
          }),
      );

      const sig = t.useSignal("FrustratedSession");
      if (sig) frustrated.push(sig.payload);
      return <div data-testid="ready" />;
    }

    const { settle } = await renderWithTflo(<Probe />);

    act(() => {
      dispatch({ kind: "rage_click", ts: 0, sessionId: "sess-1" });
    });
    await settle();

    expect(frustrated.length).toBeGreaterThan(0);
    expect(frustrated[frustrated.length - 1]).toMatchObject({ sessionId: "sess-1" });
  });
});
