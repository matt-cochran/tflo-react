import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignalCallback } from "../src/hooks/useSignalCallback";
import { useRecorder, type Recorder } from "../src/hooks/useRecorder";
import type { Pattern } from "../src/core/pattern";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

// Sequence pattern: `a` THEN `b` → "AB". It can only fire once the (later) `b`
// event has been seen — so the derived signal differs depending on the event-time
// cutoff. Replaying with ts <= tEarly (before `b`) must NOT fire; replaying with
// ts <= tLate (including `b`) MUST fire. We observe via useSignalCallback (a fire
// counter), which counts each derivation — the natural way to see "did the as-of-T
// state produce this signal?" without the sticky-latch of useSignal.
const ab = (p: Pattern<Ev>) =>
  p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "a")
    .then((e) => e.kind === "b")
    .emit(() => ({ name: "AB", payload: {} }));

// P2 — state-as-of-T / roll-back: re-derive the signals as they stood at
// event-time T by replaying only events with ts <= T. The pure engine makes the
// truncated replay deterministic, so it equals "what the system believed at T".
describe("recorder replayUntil — state-as-of-T / roll-back (P2)", () => {
  it("rolls back: as-of-T before the late event differs from as-of-T after it", async () => {
    let dispatch!: (e: Ev) => void;
    let rec!: Recorder;
    let fired = 0;

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      usePattern<Ev>("AB", ab, []);
      useSignalCallback("AB", () => {
        fired += 1;
      });
      rec = useRecorder();
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    // Record the full log: a@0, then the LATE b@100 that completes the sequence.
    await act(async () => {
      dispatch({ kind: "a", ts: 0 });
      dispatch({ kind: "b", ts: 100 });
    });
    // Live: the full log fired the derived signal exactly once.
    await waitFor(() => expect(fired).toBe(1));
    expect(rec.events().map((e) => e.ts)).toEqual([0, 100]);

    // Roll back to t=50 — BEFORE the completing `b@100`. Only `a@0` replays, so the
    // sequence is incomplete → NO new derivation. This is the state as it stood at
    // t=50: the system had not yet seen `b`, so "AB" had not fired.
    await act(async () => {
      rec.replayUntil(50);
    });
    // Give any (incorrect) async derivation a chance; assert it did NOT fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(fired).toBe(1); // still 1 — no re-derivation at the early cutoff

    // Roll forward to t=100 — now `b@100` is included, the sequence completes and
    // the derived signal fires again. as-of-T(100) ≠ as-of-T(50).
    await act(async () => {
      rec.replayUntil(100);
    });
    await waitFor(() => expect(fired).toBe(2));

    // replay() (unchanged: full log) re-derives the same fuller state once more.
    await act(async () => {
      rec.replay();
    });
    await waitFor(() => expect(fired).toBe(3));

    // And a too-early cutoff still yields nothing new — determinism, not chance.
    await act(async () => {
      rec.replayUntil(99); // 99 < 100 → `b` excluded again
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fired).toBe(3);
  });
});
