import { beforeAll, describe, expect, it } from "vitest";
import {
  CelPattern,
  CelRuntime,
  compileTypedCelPattern,
  initTfloCel,
} from "../src/cel/index";
import type { DerivedSignal } from "../src/core/pattern";

interface Ev {
  kind: string;
  productId: string;
  ts: number;
}

beforeAll(async () => {
  await initTfloCel();
});

function drive(compiled: { name: string; inner: unknown }, events: Ev[]): DerivedSignal[] {
  const rt = new CelRuntime<Ev>(compiled as never);
  const out: DerivedSignal[] = [];
  for (const e of events) out.push(...rt.push(e));
  out.push(...rt.flush());
  rt.destroy();
  return out;
}

describe("cross-step CEL context (parity with MatchContext)", () => {
  it("correlates a later step to the FIRST capture via first_<field>", () => {
    const build = () =>
      new CelPattern<Ev>("engaged")
        .timestamp((e) => e.ts)
        .whenCel('kind == "view"')
        // the scroll must be on the SAME product as the opening view
        .thenCel('kind == "scroll" && productId == first_productId')
        .within(5000)
        .emit((m) => ({ name: "engaged", payload: { productId: m.first().productId } }));

    // same product → matches
    const same = drive(build(), [
      { kind: "view", productId: "P1", ts: 0 },
      { kind: "scroll", productId: "P1", ts: 100 },
    ]);
    expect(same).toHaveLength(1);
    expect(same[0].payload.productId).toBe("P1");

    // different product → the cross-step predicate rejects it
    const diff = drive(build(), [
      { kind: "view", productId: "P1", ts: 0 },
      { kind: "scroll", productId: "P2", ts: 100 },
    ]);
    expect(diff).toHaveLength(0);
  });

  it("prev_<field> references the immediately-preceding capture", () => {
    const compiled = new CelPattern<Ev>("chain")
      .timestamp((e) => e.ts)
      .whenCel('kind == "a"')
      .thenCel('kind == "b" && productId == prev_productId')
      .thenCel('kind == "c" && productId == prev_productId')
      .emit((m) => ({ name: "chain", payload: {} }));

    const ok = drive(compiled, [
      { kind: "a", productId: "X", ts: 0 },
      { kind: "b", productId: "X", ts: 1 },
      { kind: "c", productId: "X", ts: 2 },
    ]);
    expect(ok).toHaveLength(1);
  });
});

describe("typed CEL bridge — compileTypedCelPattern<E, S>", () => {
  interface Signals extends Record<string, unknown> {
    engaged: { productId: string };
  }

  it("injects { name, ts, payload } and the payload satisfies S[K]", () => {
    const compiled = compileTypedCelPattern<Ev, Signals, "engaged">(
      {
        name: "engaged",
        when: 'kind == "view"',
        then: ['kind == "scroll" && productId == first_productId'],
        within: 5000,
      },
      (e) => e.ts,
      (m) => ({ productId: m.first().productId }),
    );

    const out = drive(compiled, [
      { kind: "view", productId: "P9", ts: 0 },
      { kind: "scroll", productId: "P9", ts: 50 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("engaged");
    expect(out[0].payload.productId).toBe("P9");
  });
});
