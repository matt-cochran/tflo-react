# Requirement — Multi-device onboarding journey (keyed event-time join)

A user begins onboarding on one device (`onboarding_start`) and completes it on a different
device (`onboarding_complete`). Both events carry a shared `userId`. Join them when they share
the same `userId` and the completion falls within 30 minutes of the start (event-time window).

## Events

**Starts (left):**
| userId | ts (ms) |
|--------|---------|
| U1     | 0       |
| U2     | 1000    |

**Completes (right):**
| userId | ts (ms)  | note                   |
|--------|----------|------------------------|
| U1     | 600000   | 10 min after start → inside 30-min window |
| U2     | 3600000  | 60 min after start → outside 30-min window |

## Window

`complete.ts ∈ [start.ts, start.ts + 1800000]` (1 800 000 ms = 30 minutes, event-time).

## Expected output

Exactly **one** join — U1:
```json
[{ "left": { "userId": "U1", "ts": 0 }, "right": { "userId": "U1", "ts": 600000 }, "deltaMs": 600000 }]
```

`out.length === 1 && out[0].left.userId === "U1" && out[0].deltaMs === 600000`

U2 does **not** join: its completion at 3 600 000 ms is 60 minutes after the start, exceeding
the 30-minute window.

## Why this matters

Cross-device journeys are common in consumer apps (start on mobile, finish on desktop).
Without event-time semantics the join collapses to wall-clock coincidence — correct only when
both events arrive before the stream is processed. tflo's `window_join_keyed` makes the
event-time constraint explicit and declarative; every other approach hand-rolls the same
`Map` + window-check logic.
