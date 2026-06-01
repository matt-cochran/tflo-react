import { beforeAll, describe, expect, it } from "vitest";
import {
  CelPattern,
  CelRuntime,
  compileCelPattern,
  initTfloCel,
} from "../src/cel/index";
import type { DerivedSignal } from "../src/core/pattern";

interface Ev {
  kind: string;
  cartId: string;
  ts: number;
}

beforeAll(async () => {
  await initTfloCel();
});

describe("CEL-string predicate patterns (serializable, no JS closures)", () => {
  it("matches an abandoned cart with CEL-string predicates", () => {
    const compiled = new CelPattern<Ev>("abandoned")
      .timestamp((e) => e.ts)
      .whenCel('kind == "add_to_cart"')
      .notThenCel('kind == "purchase"')
      .within(5000)
      .emit((m) => ({ name: "abandoned", payload: { cartId: m.first().cartId } }));

    const rt = new CelRuntime(compiled);
    const out: DerivedSignal[] = [];
    out.push(...rt.push({ kind: "add_to_cart", cartId: "X", ts: 0 }));
    out.push(...rt.push({ kind: "view", cartId: "X", ts: 6000 })); // advances past the 5000 deadline
    out.push(...rt.flush());
    rt.destroy();

    expect(out).toHaveLength(1);
    expect(out[0].payload.cartId).toBe("X");
  });

  it("does not fire when a purchase arrives in time (CEL negative cancels)", () => {
    const compiled = new CelPattern<Ev>("abandoned")
      .timestamp((e) => e.ts)
      .whenCel('kind == "add_to_cart"')
      .notThenCel('kind == "purchase"')
      .within(5000)
      .emit(() => ({ name: "abandoned", payload: {} }));

    const rt = new CelRuntime(compiled);
    const out: DerivedSignal[] = [];
    out.push(...rt.push({ kind: "add_to_cart", cartId: "X", ts: 0 }));
    out.push(...rt.push({ kind: "purchase", cartId: "X", ts: 2000 })); // within window → cancels
    out.push(...rt.flush());
    rt.destroy();

    expect(out).toHaveLength(0);
  });

  it("compiles a serializable spec (data → pattern)", () => {
    // This object could be stored or pushed from a server at runtime.
    const spec = {
      name: "abandoned",
      when: 'kind == "add_to_cart"',
      notThen: 'kind == "purchase"',
      within: 5000,
    };
    const compiled = compileCelPattern<Ev>(
      spec,
      (e) => e.ts,
      (m) => ({ name: "abandoned", payload: { cartId: m.first().cartId } }),
    );
    const rt = new CelRuntime(compiled);
    const out: DerivedSignal[] = [];
    out.push(...rt.push({ kind: "add_to_cart", cartId: "Y", ts: 0 }));
    out.push(...rt.push({ kind: "view", cartId: "Y", ts: 6000 }));
    out.push(...rt.flush());
    rt.destroy();

    expect(out).toHaveLength(1);
    expect(out[0].payload.cartId).toBe("Y");
  });

  it("throws on a malformed CEL expression at compile time", () => {
    expect(() => new CelPattern("bad").whenCel("kind ===")).toThrow();
  });
});
