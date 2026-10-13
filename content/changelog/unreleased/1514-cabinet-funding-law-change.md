---
date: 2026-10-13
title: Cabinet funding no longer gets stuck after a program law changes
summary: >-
  Changing which department funds a program, or leaving it to the states, now
  moves or ends all of that program's funding, so the national cash step can
  keep settling Cabinet departments every turn.
tags: [economy, legislation, fix]
badges: [patch]
areas: [backend]
---

## What changed

- When a law moves a program to a different department, any funding still booked for it on the old department follows it to the new one.
- When a federal program is left to the states, all of its national funding ends, including any small leftover amount, and federal spending drops by the same amount.
- Before this, a leftover amount could stay on a department that no longer ran the program, which stopped national cash and Cabinet department funding from settling on later turns.
