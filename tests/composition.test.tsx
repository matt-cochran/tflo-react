import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignalCallback } from "../src/hooks/useSignalCallback";
import { useJoin } from "../src/hooks/useJoin";
import { useRateLimit } from "../src/temporal/useRateLimit";
import { Pattern } from "../src/core/pattern";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

const ORDERS = [
  { orderId: "O1", ts: 0, amount: 100 },
  { orderId: "O2", ts: 1000, amount: 50 },
];
const PAYMENTS = [
  { orderId: "O1", ts: 2000 },
  { orderId: "O2", ts: 9000 },
];

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

describe("composition: hooks built on the primitives", () => {
  it("useRateLimit blocks after N events within the window (composes useWindow)", async () => {
    let dispatch!: (e: Ev) => void;
    let snapshot = "";
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      const { count, blocked } = useRateLimit("submit", { limit: 3, ms: 1000 });
      snapshot = ready ? `${count}:${blocked}` : "x";
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "submit", ts: 0 });
      dispatch({ kind: "submit", ts: 100 });
      dispatch({ kind: "submit", ts: 200 });
    });
    await waitFor(() => expect(snapshot).toBe("3:true"));
  });

  it("useJoin returns the keyed event-time match (scenario 2 via a hook)", async () => {
    let len = -1;
    function Probe() {
      const { ready } = useTfloContext();
      const matched = useJoin(ORDERS, PAYMENTS, { key: "orderId", ts: "ts", window: 3000 });
      len = matched.length;
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await waitFor(() => expect(len).toBe(1));
  });

  it("useSignalCallback fires a side-effect on a derived signal (no re-render needed)", async () => {
    let dispatch!: (e: Ev) => void;
    let fired = 0;
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      usePattern<Ev>("rage", rage3, []);
      useSignalCallback("rage", () => {
        fired += 1;
      });
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
  });
});
