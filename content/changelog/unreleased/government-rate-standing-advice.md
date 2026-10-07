---
date: 2026-10-08
title: The Treasury follows the central bank's advice when the government leaves rates alone
summary: >-
  Where the government sets the policy rate, as in the UK before 1997, the
  Treasury now applies the central bank's standing advice once the government
  has left the rate untouched for a quarter. The government can still set the
  rate at any time, and its own decisions always win.
tags: [economy, central-bank, uk]
badges: [minor]
areas: [backend]
---

## What changed

- A government-controlled central bank used to keep its rate frozen until a
  player in government moved it. In the live 1991 world the UK rate sat at
  4.5% for 28 turns while inflation reached 15%.
- After 12 turns without a government rate decision, the Treasury applies the
  same bounded step an independent chair would take (at most +0.75 or -1.75
  points), then waits the normal 6 turns before the next one.
- These moves appear in the bank's rate history as "Treasury, on the bank's
  standing advice". They never start or extend the government's own rate
  cooldown, so a player in government can set the rate on any turn.
