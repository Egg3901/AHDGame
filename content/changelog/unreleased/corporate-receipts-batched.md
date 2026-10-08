---
date: 2026-10-08
title: Corporate income and tax settle in shared batches
summary: >-
  Profitable corporations that pay tax to the same countries now settle their
  turn income together in batches instead of one corporation at a time.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- Profitable corporations with no unpaid bills, paying tax to the same countries, now settle their turn income and tax together, up to 64 at a time. The corporation step of each turn makes less than half as many database calls as before.
- Each corporation still receives exactly its own income after tax, and each treasury receives the same tax total as before. Corporations with unpaid bills, a loss or negative cash still settle on their own.
