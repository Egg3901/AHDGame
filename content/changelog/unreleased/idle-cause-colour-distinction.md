---
date: 2026-10-17
title: Idle plant causes use distinct colours
summary: The capacity meter shades each warning cause separately, so a sector held back for more than one reason is readable at a glance.
badges: [patch]
areas: [frontend]
tags: [corporations, sectors, accessibility]
---

The capacity meter and its legend now draw "Waiting on inputs", "Demand limited" and "Deposits ran short" in different shades of the same warning colour, so causes that appear together can be told apart. Only the colouring changes; the figures and labels are unchanged.
