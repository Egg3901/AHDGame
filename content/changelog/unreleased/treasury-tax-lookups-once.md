---
date: 2026-10-07
title: Corporate tax payments look up each treasury once
summary: >-
  Each turn now looks up every national treasury once when settling corporate
  tax, instead of once for every tax payment.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- Corporate tax payments find their national treasury from a single lookup at the start of settlement, so the corporation step makes fewer database calls. Each payment still goes to the same treasury for the same amount.
