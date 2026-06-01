import { render, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, type TfloContextValue, useTfloContext } from "../src/core/provider";
import { usePattern } from "../src/hooks/usePattern";
import { Pattern } from "../src/core/pattern";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

function build(p: Pattern<Ev>) {
  return p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "x")
    .notThen((e) => e.kind === "y")
    .within(1000)
    .emit(() => ({ name: "leaky", payload: {} }));
}

describe("StrictMode / WASM-handle lifecycle", () => {
  it("registers exactly once under StrictMode double-mount and frees on unmount (no leak)", async () => {
    let ctx: TfloContextValue | null = null;
    function Capture() {
      ctx = useTfloContext();
      usePattern<Ev>("leaky", build, []);
      return null;
    }
    const { unmount } = render(
      <React.StrictMode>
        <TfloProvider>
          <Capture />
        </TfloProvider>
      </React.StrictMode>,
    );

    await waitFor(() => expect(ctx?.ready).toBe(true));
    // After StrictMode's mount→unmount→mount, exactly one runtime is live.
    await waitFor(() => expect(ctx!.runtimes.size()).toBe(1));

    unmount();
    // Handle freed — no leak.
    expect(ctx!.runtimes.size()).toBe(0);
  });
});
