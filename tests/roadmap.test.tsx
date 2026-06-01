import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useCelRules } from "../src/hooks/useCelRules";
import { TfloDevtools } from "../src/devtools/index";
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

describe("devtools panel", () => {
  it("shows the registered runtime and logs derived signals", async () => {
    let dispatch!: (e: Ev) => void;
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      usePattern<Ev>("rage", rage3, []);
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
        <TfloDevtools />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "click", ts: 0 });
      dispatch({ kind: "click", ts: 200 });
      dispatch({ kind: "click", ts: 400 });
    });
    // The devtools panel logged the "rage" signal.
    await waitFor(() =>
      expect(screen.getByTestId("tflo-devtools-signals").textContent).toBe("signals: 1"),
    );
  });
});

const RULES = {
  rules: [
    { name: "hot", condition: "value > 80", action: { type: "alert" } },
    { name: "cold", condition: "value < 20", action: { type: "log" } },
  ],
};
const ITEMS = [
  { id: "a", value: 85 },
  { id: "b", value: 50 },
  { id: "c", value: 10 },
];

describe("useCelRules — rules as data, evaluated by tflo's CEL engine in WASM", () => {
  it("matches items against server-shaped rules", async () => {
    let result: { item_id: string; matched_rules: string[] }[] = [];
    function Probe() {
      const { ready } = useTfloContext();
      result = useCelRules(RULES, ITEMS);
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await waitFor(() => expect(result).toHaveLength(3));
    expect(result[0]).toMatchObject({ item_id: "a", matched_rules: ["hot"] });
    expect(result[1].matched_rules).toEqual([]);
    expect(result[2]).toMatchObject({ item_id: "c", matched_rules: ["cold"] });
  });
});
