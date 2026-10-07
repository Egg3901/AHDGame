---
date: 2026-10-07
title: Fewer database writes for money entering or leaving the world
summary: >-
  Payments that create or retire money, such as realized corporate receipts and
  write-offs, record that step together with the payment's completion instead
  of with a write of its own.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- The step where a payment creates or retires money has no balance to update, so it is now recorded in the same write that completes the payment. An interrupted payment still finishes on resume.
