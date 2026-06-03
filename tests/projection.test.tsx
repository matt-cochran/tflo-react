import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { useProjection, type Projection } from "../src/hooks/useProjection";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
  user: string;
}

// Phase 2: derived state, not stored state. The onboarding "status" of each user
// is FOLDED from their event history — no status field, no flag to keep in sync.
// A correction is just a later event the reducer applies (last-writer-wins).
describe("useProjection: derived current state per entity (Phase 2)", () => {
  it("folds events into queryable per-key state; corrections supersede", async () => {
    let dispatch!: (e: Ev) => void;
    let proj: Projection<string, string> | undefined;

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      // current status := the kind of the latest event for that user (incremental)
      proj = useProjection<Ev, string, string>(
        (e) => e.user,
        (_prev, e) => e.kind,
      );
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    await act(async () => {
      dispatch({ kind: "signup", ts: 0, user: "u1" });
      dispatch({ kind: "activated", ts: 1, user: "u1" });
      dispatch({ kind: "signup", ts: 2, user: "u2" });
    });

    await waitFor(() => expect(proj?.get("u1")).toBe("activated"));
    expect(proj?.get("u2")).toBe("signup");
    expect(proj?.size).toBe(2);
    expect(proj?.entries().length).toBe(2);
    expect(proj?.get("absent")).toBeUndefined();

    // A correction: a superseding event for u1 — derived status updates, no flag.
    await act(async () => {
      dispatch({ kind: "deactivated", ts: 3, user: "u1" });
    });
    await waitFor(() => expect(proj?.get("u1")).toBe("deactivated"));
    expect(proj?.size).toBe(2); // still two entities
  });

  it("respects the kind filter", async () => {
    let dispatch!: (e: Ev) => void;
    let proj: Projection<string, number> | undefined;

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      // count only "click" events per user
      proj = useProjection<Ev, string, number>(
        (e) => e.user,
        (prev, _e) => (prev ?? 0) + 1,
        { kind: "click" },
      );
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    await act(async () => {
      dispatch({ kind: "click", ts: 0, user: "u1" });
      dispatch({ kind: "scroll", ts: 1, user: "u1" }); // filtered out
      dispatch({ kind: "click", ts: 2, user: "u1" });
    });
    await waitFor(() => expect(proj?.get("u1")).toBe(2));
  });
});
