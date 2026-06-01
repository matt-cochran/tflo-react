import { beforeAll, describe, expect, it } from "vitest";
import { Pattern, PatternRuntime } from "../../src/core/pattern";
import { initTflo } from "../../src/core/wasmInit";
import { TypedPattern } from "../../src/typed/pattern";

beforeAll(async () => {
  await initTflo();
});

type Events =
  | { kind: "add_to_cart"; ts: number; cartId: string; sku: string }
  | { kind: "purchase"; ts: number; cartId: string };

type Signals = {
  abandoned_cart: { cartId: string };
};

describe("TypedPattern — soft delegate, strict surface", () => {
  it("produces the same matches as a raw Pattern and emits the typed payload", () => {
    // Abandoned cart: add_to_cart NOT followed by a purchase within 1000ms.
    const tp = new TypedPattern<Events, Signals, "abandoned_cart">(
      new Pattern("abandoned_cart"),
      "abandoned_cart",
    )
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "add_to_cart")
      .notThen((e) => e.kind === "purchase")
      .within(1000)
      .emit((m) => {
        const first = m.first();
        // `first` is the discriminated union; the add_to_cart member has cartId.
        return { cartId: first.kind === "add_to_cart" ? first.cartId : "" };
      });

    const rt = new PatternRuntime(tp);
    const out: Array<{ name: string; payload: Record<string, unknown> }> = [];
    out.push(...rt.push({ kind: "add_to_cart", ts: 0, cartId: "c1", sku: "s1" } as Events));
    // No purchase; advance past the window so the negative completes.
    out.push(...rt.push({ kind: "add_to_cart", ts: 2000, cartId: "c2", sku: "s2" } as Events));
    out.push(...rt.flush());
    rt.destroy();

    const abandoned = out.find((s) => s.name === "abandoned_cart");
    expect(abandoned).toBeTruthy();
    expect(abandoned!.payload).toMatchObject({ cartId: "c1" });
  });

  it("matches a raw Pattern for the positive (sequence) shape", () => {
    // Raw reference pattern: A then B within 1000ms.
    const raw = new Pattern<{ ts: number; kind: string }>("ab")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "a")
      .then((e) => e.kind === "b")
      .within(1000)
      .emit(() => ({ name: "ab", payload: { hit: true } }));
    const rawRt = new PatternRuntime(raw);
    const rawOut = [
      ...rawRt.push({ ts: 0, kind: "a" }),
      ...rawRt.push({ ts: 100, kind: "b" }),
    ];
    rawRt.destroy();

    // Typed equivalent.
    type E2 = { kind: "a"; ts: number } | { kind: "b"; ts: number };
    type S2 = { ab: { hit: boolean } };
    const typed = new TypedPattern<E2, S2, "ab">(new Pattern("ab"), "ab")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "a")
      .then((e) => e.kind === "b")
      .within(1000)
      .emit(() => ({ hit: true }));
    const typedRt = new PatternRuntime(typed);
    const typedOut = [
      ...typedRt.push({ kind: "a", ts: 0 }),
      ...typedRt.push({ kind: "b", ts: 100 }),
    ];
    typedRt.destroy();

    expect(rawOut.length).toBe(typedOut.length);
    expect(rawOut.length).toBe(1);
    expect(typedOut[0].payload).toMatchObject({ hit: true });
  });
});
