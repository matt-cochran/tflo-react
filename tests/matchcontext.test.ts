import { beforeAll, describe, expect, it } from "vitest";
import { initTflo } from "../src/core/wasmInit";
import { Pattern, PatternRuntime, type DerivedSignal } from "../src/core/pattern";

interface Ev {
  kind: string;
  productId: string;
  ts: number;
}

beforeAll(async () => {
  await initTflo();
});

// "engaged" = a `view`, then a `scroll` ON THE SAME PRODUCT within 5s. The
// then-predicate correlates across steps via the match context — so a SINGLE
// runtime tracks interleaved products correctly (no partitioning needed).
function engaged() {
  return new Pattern<Ev>("engaged")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "view")
    .then((e, ctx) => e.kind === "scroll" && e.productId === ctx.first()?.productId)
    .within(5000)
    .emit((m) => ({ name: "engaged", payload: { productId: m.first().productId } }));
}

describe("MatchContext — cross-step field correlation in one runtime", () => {
  it("matches each product's view→scroll independently when interleaved", () => {
    const rt = new PatternRuntime(engaged());
    const out: DerivedSignal[] = [];
    out.push(...rt.push({ kind: "view", productId: "P1", ts: 0 }));
    out.push(...rt.push({ kind: "view", productId: "P2", ts: 100 }));
    out.push(...rt.push({ kind: "scroll", productId: "P2", ts: 200 })); // → P2
    out.push(...rt.push({ kind: "scroll", productId: "P1", ts: 300 })); // → P1
    rt.destroy();
    expect(out.map((s) => s.payload.productId)).toEqual(["P2", "P1"]);
  });

  it("rejects a scroll on a different product than the view", () => {
    const rt = new PatternRuntime(engaged());
    const out: DerivedSignal[] = [];
    out.push(...rt.push({ kind: "view", productId: "P1", ts: 0 }));
    out.push(...rt.push({ kind: "scroll", productId: "P2", ts: 100 })); // different product
    out.push(...rt.flush());
    rt.destroy();
    expect(out).toHaveLength(0);
  });
});
