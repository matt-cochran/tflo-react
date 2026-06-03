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

// Card-testing interior negation via CEL strings: auth_fail then auth_fail with
// NO auth_success between — the interval negation a terminal notThen cannot
// express. Mirrors the engine's interior_negation use-case tests.
interface AuthEv {
  kind: string;
  ts: number;
}

function cardTestingCel(events: AuthEv[], builder = false): DerivedSignal[] {
  const compiled = builder
    ? new CelPattern<AuthEv>("card_testing")
        .timestamp((e) => e.ts)
        .whenCel('kind == "auth_fail"')
        .notBetweenCel('kind == "auth_success"')
        .thenCel('kind == "auth_fail"')
        .within(60_000)
        .emit((m) => ({ name: "card_testing", payload: { firstTs: m.first().ts } }))
    : compileCelPattern<AuthEv>(
        JSON.parse(
          JSON.stringify({
            name: "card_testing",
            when: 'kind == "auth_fail"',
            then: ['kind == "auth_fail"'],
            notBetween: ['kind == "auth_success"'],
            within: 60_000,
          }),
        ),
        (e) => e.ts,
        (m) => ({ name: "card_testing", payload: { firstTs: m.first().ts } }),
      );
  const rt = new CelRuntime(compiled);
  const out: DerivedSignal[] = [];
  for (const e of events) out.push(...rt.push(e));
  out.push(...rt.flush());
  rt.destroy();
  return out;
}

describe("CEL interior negation — notBetweenCel / spec.notBetween", () => {
  for (const builder of [true, false]) {
    const label = builder ? "builder (notBetweenCel)" : "spec round-trip (notBetween[])";
    it(`${label}: fires on two fails with no success between`, () => {
      const out = cardTestingCel(
        [
          { kind: "auth_fail", ts: 0 },
          { kind: "view_page", ts: 10_000 },
          { kind: "auth_fail", ts: 20_000 },
        ],
        builder,
      );
      expect(out).toHaveLength(1);
      expect(out[0].payload.firstTs).toBe(0);
    });

    it(`${label}: is suppressed by an interior success`, () => {
      const out = cardTestingCel(
        [
          { kind: "auth_fail", ts: 0 },
          { kind: "auth_success", ts: 10_000 },
          { kind: "auth_fail", ts: 20_000 },
        ],
        builder,
      );
      expect(out).toHaveLength(0);
    });
  }
});
