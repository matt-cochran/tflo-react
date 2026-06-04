# Requirement — Temporal windowed join (event-time)

Join a `payment` to its `order` when `payment.ts ∈ [order.ts, order.ts + 3000]`
(an **event-time** window), emitting `{ orderId, amount, latencyMs }`.

Orders: `O1@0 (amount 100)`, `O2@1000 (amount 50)`.
Payments: `O1@2000`, `O2@9000`.

Expected: `[{ orderId: "O1", amount: 100, latencyMs: 2000 }]` — O2's payment at ts=9000 is out
of window. The keyed buffer and the event-time window check are hand-written in every approach
except tflo (`window_join_keyed`), which omits no watermark/eviction/late-data policy.
