---
date: 2026-10-03
title: Faster union strike decisions during turns
summary: >-
  NPP-led unions deciding whether to escalate a dispute now share the turn's
  country and state readings instead of looking them up again for every dispute.
tags: [performance, turns, unions]
badges: [patch]
areas: [backend]
---

## What changed

- Escalation uses the same labour-market and cost-of-living readings the turn already loaded for opening campaigns. The readings and the decisions are unchanged.
