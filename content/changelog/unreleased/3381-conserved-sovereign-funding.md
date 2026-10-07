---
date: 2026-10-07
title: Conserved sovereign financing groundwork (off by default)
summary: >-
  Adds an opt-in fiscal cash model where national tax and spending move real,
  conserved cash between the non-player economy and each Treasury, so sovereign
  coupons can be paid without creating money. No world runs it yet.
tags: [economy, treasury, bonds]
# One of: major | minor | patch | hotfix
badges: [minor]
# Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- New per-world switch, off everywhere: when on, the national tax slice moves cash from the country's existing household money stock into the Treasury, coupons are paid from it, and primary spending returns cash to the same stock.
- Nothing is minted. A side that cannot pay carries an explicit arrear to the next turn instead of overdrawing or silently succeeding.
- Corporate tax and state-enterprise profits already paid into the Treasury that turn are subtracted from the non-player revenue slice so they are not collected twice.
- Bond market pool liquidity under the switch moves to and from household savings instead of being minted and burned.
- Every move is a journaled, idempotent settlement, so a retried or interrupted turn resumes instead of paying twice.
- Existing worlds keep their current behavior. A world reset clears the switch.
