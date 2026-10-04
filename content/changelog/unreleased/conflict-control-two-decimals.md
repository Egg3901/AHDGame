---
date: 2026-10-02
title: War control shown to two decimals
summary: >-
  Each side's share of control in a war is shown with two decimals, and the two
  sides always add up to 100.00%.
tags: [war, conflicts, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- The war record, the global conflicts board, the front line maps and the situation board show control as a two-decimal split, such as 62.35% and 37.65%. The second side is the remainder of the first, so the pair always totals 100.00%.
- A side shows 0.00% or 100.00% only when control is exactly 0 or 100, which is where a war resolves. A value that would round to either extreme while the war is still running shows as 0.01% or 99.99%.

Pull request: [#2880](https://github.com/Egg3901/AHDGame/pull/2880).
