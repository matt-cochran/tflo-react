import { beforeAll, describe, expect, it } from "vitest";
import { initTfloOps } from "../src/core/wasmInit";
import { tumblingWindow, windowJoinKeyed } from "../src/core/ops";

beforeAll(async () => {
  await initTfloOps();
});

describe("scenario 2 — keyed event-time temporal join", () => {
  it("joins a payment to its order within the forward window, by key", () => {
    const out = windowJoinKeyed(
      [
        { orderId: "O1", ts: 0, amount: 100 },
        { orderId: "O2", ts: 1000, amount: 50 },
      ],
      [
        { orderId: "O1", ts: 2000 },
        { orderId: "O2", ts: 9000 }, // outside [1000,4000] → no join
      ],
      { key: "orderId", ts: "ts", window: 3000 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].left).toMatchObject({ orderId: "O1", amount: 100 });
    expect(out[0].right).toMatchObject({ orderId: "O1", ts: 2000 });
    expect(out[0].deltaMs).toBe(2000);
  });
});

describe("scenario 3 — event-time tumbling windows with out-of-order tolerance", () => {
  // Arrival order is NOT timestamp order. The claim: with sufficient lateness,
  // the late event ts=1000 (arriving AFTER ts=3000) still lands in [0,2000).
  it("buckets out-of-order events by event-time", () => {
    const out = tumblingWindow(
      [
        { ts: 0, value: 1 },
        { ts: 3000, value: 10 },
        { ts: 1000, value: 2 }, // late: belongs in [0,2000)
        { ts: 2000, value: 20 },
        { ts: 5000, value: 100 },
        { ts: 4000, value: 40 }, // late: belongs in [4000,6000)
      ],
      { windowMs: 2000, allowedLatenessMs: 2000 },
    );

    const w0 = out.find((w) => w.windowStart === 0);
    const w2 = out.find((w) => w.windowStart === 2000);
    const w4 = out.find((w) => w.windowStart === 4000);

    expect(w0).toMatchObject({ count: 2, sum: 3 }); // ts0(1) + late ts1000(2)
    expect(w2).toMatchObject({ count: 2, sum: 30 }); // ts2000(20) + ts3000(10)
    expect(w4).toMatchObject({ count: 2, sum: 140 }); // ts4000(40) + ts5000(100)
  });
});
