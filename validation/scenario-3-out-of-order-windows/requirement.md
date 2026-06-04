# Requirement — Out-of-order / late-event tumbling windows (event-time)

Tumbling **event-time** windows of 2000 ms. A late event (`ts=1000` arriving *after* `ts=3000`)
must still land in `[0, 2000)` when `allowedLateness ≥ 2000`.

Arrivals (NOT in ts order): `0:1, 3000:10, 1000:2, 2000:20, 5000:100, 4000:40`.

Expected (allowedLateness=2000):
`[{windowStart:0,count:2,sum:3}, {windowStart:2000,count:2,sum:30}, {windowStart:4000,count:2,sum:140}]`.

The late event survives into `[0,2000)` only via a hand-built watermark + bucket + lateness
engine in React/Signals/RxJS; XState cannot model it (the FSM is inert). tflo: one
`tumbling_window` call with `allowedLatenessMs`.
