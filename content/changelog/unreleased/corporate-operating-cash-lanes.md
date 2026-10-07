---
date: 2026-10-07
title: Corporate operating cash settles without stalling the turn
summary: >-
  Each corporation's operating receipts were settled one corporation at a time,
  so a world with several hundred corporations could run the corporation phase
  past its time limit. Independent corporations now settle in a few lanes with
  the same receipts, the same amounts and the same order inside each
  corporation.
tags: [stability, performance]
badges: [hotfix]
areas: [backend, economy]
---

## What changed

- Corporate gross receipts, operating losses, prior arrears and tax withholding
  run in up to eight lanes of independent corporations instead of one.
- Each corporation still settles gross receipts first, then prior arrears, then
  any loss, then tax withholding, and a corporation listed twice settles its
  entries in input order.
- Tax receipts into the same country's Treasury still land one at a time, so
  every receipt is paid once and none is refused for contention.
- If any corporation fails, no new corporation starts, every corporation
  already in progress finishes, and the turn then reports the failure. Retries
  resume from the same durable receipts as before.
