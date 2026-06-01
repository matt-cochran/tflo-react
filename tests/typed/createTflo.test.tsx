import { act } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { createTflo } from "../../src/index";
import { renderWithTflo } from "../../src/testing/index";

type Events =
  | { kind: "add_to_cart"; ts: number; cartId: string; sku: string }
  | { kind: "purchase"; ts: number; cartId: string };

type Signals = {
  abandoned_cart: { cartId: string };
};

const t = createTflo<Events, Signals>();

describe("createTflo<E,S> — typed facade over the real WASM engine", () => {
  it("emits abandoned_cart (add_to_cart with no purchase in window) with the right cartId", async () => {
    let dispatch!: (e: Events) => void;
    const observed: Array<{ cartId: string }> = [];

    function Probe() {
      dispatch = t.useEmit();
      t.usePattern("abandoned_cart", (p) =>
        p
          .timestamp((e) => e.ts)
          .when((e) => e.kind === "add_to_cart")
          .notThen((e) => e.kind === "purchase")
          .within(1000)
          .emit((m) => {
            const first = m.first();
            return { cartId: first.kind === "add_to_cart" ? first.cartId : "" };
          }),
      );
      const sig = t.useSignal("abandoned_cart");
      if (sig) observed.push(sig.payload);
      return <div data-testid="ready" />;
    }

    const { settle } = await renderWithTflo(<Probe />);

    // add_to_cart for c1, then a later add_to_cart pushes event-time past the
    // 1000ms window → the negative (no purchase) completes for c1.
    act(() => {
      dispatch({ kind: "add_to_cart", ts: 0, cartId: "c1", sku: "s1" });
      dispatch({ kind: "add_to_cart", ts: 2000, cartId: "c2", sku: "s2" });
    });
    await settle();

    expect(observed.length).toBeGreaterThan(0);
    expect(observed[observed.length - 1]).toMatchObject({ cartId: "c1" });
  });

  it("does NOT emit abandoned_cart when a purchase arrives within the window", async () => {
    let dispatch!: (e: Events) => void;
    let fired = false;

    function Probe() {
      dispatch = t.useEmit();
      t.usePattern("abandoned_cart", (p) =>
        p
          .timestamp((e) => e.ts)
          .when((e) => e.kind === "add_to_cart")
          .notThen((e) => e.kind === "purchase")
          .within(1000)
          .emit((m) => {
            const first = m.first();
            return { cartId: first.kind === "add_to_cart" ? first.cartId : "" };
          }),
      );
      const sig = t.useSignal("abandoned_cart");
      if (sig) fired = true;
      return <div data-testid="ready" />;
    }

    const { settle } = await renderWithTflo(<Probe />);

    act(() => {
      dispatch({ kind: "add_to_cart", ts: 0, cartId: "c1", sku: "s1" });
      dispatch({ kind: "purchase", ts: 500, cartId: "c1" }); // within window → no abandon
      dispatch({ kind: "add_to_cart", ts: 3000, cartId: "c2", sku: "s2" });
    });
    await settle();

    expect(fired).toBe(false);
  });
});
