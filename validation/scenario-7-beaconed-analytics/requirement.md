# Requirement — Beaconed analytics: event-time tumbling windows over out-of-order beacon batches

A browser SDK flushes pageview and interaction events in **batches** (beacons). Because
the browser queues events locally before flushing, the server receives them in **arrival
order**, which is NOT the same as **event-time order**. A late beacon carrying
`ts=1000` may arrive after a beacon carrying `ts=3000`.

An analytics pipeline that buckets by **event time** (not arrival time) must still place
the late pageview in the correct window `[0, 2000)` — otherwise early-session engagement
is under-counted and conversion attribution breaks.

## Window config

| Parameter | Value |
|---|---|
| Window width | 2000 ms (event-time tumbling) |
| Allowed lateness | 2000 ms (beacon flush delay budget) |

## Beacon arrivals (NOT in ts order)

```
ts=0    value=1   (pageview — session start)
ts=3000 value=10  (interaction — arrives first in batch)
ts=1000 value=2   (pageview — late beacon, belongs in [0,2000))
ts=2000 value=20  (interaction)
ts=5000 value=100 (interaction)
ts=4000 value=40  (pageview)
```

## Expected windows

```
[
  { windowStart:    0, count: 2, sum:   3 },   // ts=0  + ts=1000  (late beacon recovered)
  { windowStart: 2000, count: 2, sum:  30 },   // ts=2000 + ts=3000
  { windowStart: 4000, count: 2, sum: 140 },   // ts=4000 + ts=5000
]
```

The late beacon (`ts=1000`, arriving after `ts=3000`) survives into `[0, 2000)` only
because `allowedLatenessMs: 2000` permits it. Without the lateness budget the late
pageview is dropped and the session-start window shows `count:1, sum:1` — wrong.

tflo handles this with a single `tumbling_window` call. Every other library requires
~20 lines of hand-built watermark + bucket + lateness-sealing logic to produce the
same result.
