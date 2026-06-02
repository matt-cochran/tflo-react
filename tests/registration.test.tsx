import { act, render, screen, waitFor } from "@testing-library/react";
import React, { useLayoutEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import type { Pattern } from "../src/core/pattern";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

const ping = (p: Pattern<Ev>) =>
  p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "ping")
    .emit(() => ({ name: "ping", payload: {} }));

/**
 * The race: a pattern is mounted AFTER the engine is already `ready` (bus open,
 * no buffering), and a dispatch fires in the SAME commit via a layout effect —
 * which runs BEFORE passive effects. If registration lived only in a passive
 * `useEffect`, the dispatch would hit zero runtimes and be dropped. Synchronous
 * render-phase registration closes that window.
 */
describe("race-proof synchronous registration", () => {
  it("a same-commit layout-effect dispatch reaches a just-mounted pattern (post-ready)", async () => {
    let signalSeen = false;
    let setShow!: (v: boolean) => void;

    function Racer() {
      const dispatch = useEmit<Ev>();
      const sig = usePattern<Ev>("ping", ping, []);
      // Fires before the passive registration effect would have run.
      useLayoutEffect(() => {
        dispatch({ kind: "ping", ts: 0 });
      }, [dispatch]);
      if (sig) signalSeen = true;
      return null;
    }

    function App() {
      const { ready } = useTfloContext();
      const [show, setShowState] = useState(false);
      setShow = setShowState;
      return (
        <>
          <div data-testid="ready">{String(ready)}</div>
          {show ? <Racer /> : null}
        </>
      );
    }

    render(
      <TfloProvider>
        <App />
      </TfloProvider>,
    );

    // Engine fully ready (bus open) BEFORE the racing pattern mounts.
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    await act(async () => {
      setShow(true);
    });

    await waitFor(() => expect(signalSeen).toBe(true));
  });

  it("does not leak registrations across mount/unmount cycles", async () => {
    let registry!: ReturnType<typeof useTfloContext>["runtimes"];
    let setShow!: (v: boolean) => void;

    function Racer() {
      usePattern<Ev>("ping", ping, []);
      return null;
    }
    function App() {
      const { ready, runtimes } = useTfloContext();
      registry = runtimes;
      const [show, setShowState] = useState(true);
      setShow = setShowState;
      return (
        <>
          <div data-testid="ready">{String(ready)}</div>
          {show ? <Racer /> : null}
        </>
      );
    }

    render(
      <TfloProvider>
        <App />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await waitFor(() => expect(registry.size()).toBe(1));

    await act(async () => {
      setShow(false); // unmount
    });
    await waitFor(() => expect(registry.size()).toBe(0));

    await act(async () => {
      setShow(true); // remount → exactly one registration again
    });
    await waitFor(() => expect(registry.size()).toBe(1));
  });
});
