import { beforeAll, describe, expect, it } from "vitest";
import { initTflo } from "../src/core/wasmInit";
import { Pattern, PatternRuntime, type DerivedSignal } from "../src/core/pattern";

interface Ev {
  kind: string;
  ts: number;
}

beforeAll(async () => {
  await initTflo();
});

function drive(compiled: ReturnType<Pattern<Ev>["emit"]>, events: Ev[]): DerivedSignal[] {
  const rt = new PatternRuntime(compiled);
  const out: DerivedSignal[] = [];
  for (const e of events) out.push(...rt.push(e));
  out.push(...rt.flush());
  rt.destroy();
  return out;
}

const ev = (kind: string, ts: number): Ev => ({ kind, ts });

describe("repeated(min..=max) quantifier — .times()", () => {
  it("exactly N: matches when the predicate fires N times, not fewer", () => {
    const build = () =>
      new Pattern<Ev>("rage")
        .timestamp((e) => e.ts)
        .when((e) => e.kind === "down")
        .then((e) => e.kind === "click")
        .times(3, 3)
        .emit((m) => ({ name: "rage", payload: { n: m.length } }));

    const fired = drive(build(), [ev("down", 0), ev("click", 1), ev("click", 2), ev("click", 3)]);
    expect(fired).toHaveLength(1);
    expect(fired[0].payload.n).toBe(4); // down + 3 clicks captured

    const tooFew = drive(build(), [ev("down", 0), ev("click", 1), ev("click", 2)]);
    expect(tooFew).toHaveLength(0);
  });

  it("min..max: a terminating event ends the run and is matched as the next step", () => {
    const compiled = new Pattern<Ev>("burst")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "start")
      .then((e) => e.kind === "tick")
      .times(1, 5)
      .then((e) => e.kind === "stop")
      .emit((m) => ({ name: "burst", payload: { n: m.length } }));

    const out = drive(compiled, [ev("start", 0), ev("tick", 1), ev("tick", 2), ev("stop", 3)]);
    expect(out).toHaveLength(1);
    expect(out[0].payload.n).toBe(4); // start + 2 ticks + stop
  });

  it("greedy cap: stops consuming at max", () => {
    const compiled = new Pattern<Ev>("cap")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "start")
      .then((e) => e.kind === "tick")
      .times(2, 2)
      .then((e) => e.kind === "stop")
      .emit((m) => ({ name: "cap", payload: { n: m.length } }));

    // 3 ticks: only 2 are consumed by the quantifier, the 3rd is skipped, stop closes.
    const out = drive(compiled, [
      ev("start", 0),
      ev("tick", 1),
      ev("tick", 2),
      ev("tick", 3),
      ev("stop", 4),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].payload.n).toBe(4); // start + 2 ticks + stop
  });
});

describe("contiguity — .next()", () => {
  it("strict next: an intervening event kills the match", () => {
    const build = () =>
      new Pattern<Ev>("direct")
        .timestamp((e) => e.ts)
        .when((e) => e.kind === "a")
        .then((e) => e.kind === "b")
        .next()
        .emit(() => ({ name: "direct", payload: {} }));

    expect(drive(build(), [ev("a", 0), ev("b", 1)])).toHaveLength(1); // immediate
    expect(drive(build(), [ev("a", 0), ev("x", 1), ev("b", 2)])).toHaveLength(0); // x breaks it
  });

  it("default (eventually) skips intervening events", () => {
    const compiled = new Pattern<Ev>("loose")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "a")
      .then((e) => e.kind === "b")
      .emit(() => ({ name: "loose", payload: {} }));

    expect(drive(compiled, [ev("a", 0), ev("x", 1), ev("b", 2)])).toHaveLength(1);
  });
});
