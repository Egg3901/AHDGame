---
date: 2026-09-15
title: Open executive seats no longer carry an incumbency bonus
summary: >-
  A governor or president race for a vacant office is an open race. It no longer
  borrows the last winner's margin as an incumbency shield, so challengers stop
  being dragged by a result they had nothing to do with.
tags: [elections, incumbency, governor, president]
badges: [patch]
areas: [fullstack]
---

## Fixed

- Treat a vacant single-winner executive seat (governor, Minister-President, President) as a genuinely open race. The Incumbency driver now reads zero instead of inheriting the previous cycle's vote split.
- Stop the Persuasion Drivers card from showing an Incumbency figure for an office nobody currently holds. Florida's governor race was showing a 1.4 point drag against a party that had never held the seat.
