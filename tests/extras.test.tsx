import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignalCallback } from "../src/hooks/useSignalCallback";
import { useRecorder, type Recorder } from "../src/hooks/useRecorder";
import { initTfloOps } from "../src/core/wasmInit";
import * as indicators from "../src/core/indicators";
import { Pattern } from "../src/core/pattern";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

function rage3(p: Pattern<Ev>) {
  return p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "click")
    .then((e) => e.kind === "click")
    .within(1000)
    .then((e) => e.kind === "click")
    .within(1000)
    .emit(() => ({ name: "rage", payload: {} }));
}

describe("useRecorder — deterministic replay re-derives the same signals", () => {
  it("records the stream and replaying it fires the derived signal again", async () => {
    let dispatch!: (e: Ev) => void;
    let recorder!: Recorder;
    let fired = 0;
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      usePattern<Ev>("rage", rage3, []);
      useSignalCallback("rage", () => {
        fired += 1;
      });
      recorder = useRecorder();
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "click", ts: 0 });
      dispatch({ kind: "click", ts: 200 });
      dispatch({ kind: "click", ts: 400 });
    });
    await waitFor(() => expect(fired).toBe(1));
    expect(recorder.events()).toHaveLength(3);

    // Replay re-derives the signal deterministically.
    await act(async () => {
      recorder.replay();
    });
    await waitFor(() => expect(fired).toBe(2));
  });
});

describe("indicators — the rest of tflo's ops surface, typed", () => {
  beforeAll(async () => {
    await initTfloOps();
  });
  it("computes a simple moving average via the WASM engine", () => {
    const ticks = [1, 2, 3, 4, 5].map((value, ts) => ({ ts, value }));
    const out = indicators.sma(ticks, 3);
    expect(out).toHaveLength(5);
    // post-warmup: (1+2+3)/3=2, (2+3+4)/3=3, (3+4+5)/3=4
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });
});
