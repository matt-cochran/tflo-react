import { render, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, type TfloContextValue, useTfloContext } from "../src/core/provider";
import { renderWithTflo } from "../src/testing/index";

// ACCEPTANCE 2: simulate init failure via the `init` seam → `error` is set,
// `ready` stays false, and the app does NOT hang (we render and read the ctx).

describe("init failure surfacing (Gap 2)", () => {
  it("sets ctx.error and leaves ready=false when init rejects", async () => {
    let ctx: TfloContextValue | null = null;
    const boom = new Error("kaboom");

    function Capture() {
      ctx = useTfloContext();
      return <div data-testid="state">{ctx.error ? "error" : ctx.ready ? "ready" : "pending"}</div>;
    }

    render(
      <TfloProvider init={() => Promise.reject(boom)}>
        <Capture />
      </TfloProvider>,
    );

    await waitFor(() => expect(ctx?.error).toBe(boom));
    expect(ctx!.ready).toBe(false);
  });

  it("renderWithTflo resolves (does not hang) on init failure and exposes ctx.error", async () => {
    const boom = new Error("init exploded");
    const { ctx } = await renderWithTflo(<div />, {
      init: () => Promise.reject(boom),
    });
    expect(ctx.error).toBe(boom);
    expect(ctx.ready).toBe(false);
  });

  it("a non-Error rejection still produces a non-null error", async () => {
    let ctx: TfloContextValue | null = null;
    function Capture() {
      ctx = useTfloContext();
      return null;
    }
    render(
      // eslint-disable-next-line prefer-promise-reject-errors
      <TfloProvider init={() => Promise.reject(undefined)}>
        <Capture />
      </TfloProvider>,
    );
    await waitFor(() => expect(ctx?.error).not.toBeNull());
    expect(ctx!.ready).toBe(false);
  });
});
