---
date: 2026-10-07
title: Faster settlement of payments with many recipients
summary: >-
  Payments that go to many recipients at once, such as product advertising
  spread across media outlets, now settle in a handful of database calls
  instead of several per recipient. The corporation step of the turn is much
  shorter as a result.
tags: [turns, performance, corporations, media]
badges: [patch]
areas: [backend]
---

## What changed

- A payment with many recipients now credits them together while keeping the same safeguards: each recipient is still paid exactly once, a recipient that cannot be paid is still recorded as owed, and an interrupted payment still finishes cleanly on the next turn.
- On a copy of the 1991 world, the corporation step of a turn went from about 73,000 database calls to about 21,000.
