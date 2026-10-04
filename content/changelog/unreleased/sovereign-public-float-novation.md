---
date: 2026-10-05
title: Refinance eligible sovereign public float at maturity
summary: >-
  Eligible pool-owned sovereign public float can roll into equal-face primary
  debt atomically, leaving only the frozen residual for funded cash settlement.
tags: [economy, bonds, treasury]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Freeze the source bond, treasury, appetite, and native-currency identities
  before an eligible public-float swap.
- Exchange accepted face for equal-face replacement debt in one required
  Mongo transaction. If appetite is missing or source terms drift, retain the
  original funded cash path.
- Keep bank and character holders on their existing funded cash claim path, and
  settle only the frozen residual after the swap.
