---
date: 2026-10-08
title: Sector values now count shipping costs and haul income
summary: >-
  A sector's going-concern value, and so its company's share price, now
  reflects what it pays for freight and what it earns hauling it. Companies
  whose freight bill ate their profit are no longer valued as if they had
  kept it.
tags: [economy, corporations]
badges: [patch]
areas: [backend]
---

## What changed

- The value of a sector is based on its yearly profit. That profit used to
  leave out the freight bill a sector pays and the haul income a freight
  sector earns, even though both already counted in the company's earnings.
- A sector that ships a lot now carries that cost in its value, and a freight
  carrier now gets credit for the haul income it earns.
- Share prices of heavy shippers can fall toward what their earnings support,
  and freight carriers can rise. Cash on hand and other assets are unchanged.
