---
date: 2026-10-08
title: Computer-run companies keep growing while maintenance orders are pending
summary: >-
  Small maintenance orders no longer lock a company out of expanding a
  healthy plant. Growth is now limited by how much new capacity is already on
  the way, not by how many orders are waiting.
tags: [economy, corporations]
badges: [patch]
areas: [backend]
---

## What changed

- Computer-run companies queue a tiny replacement order for the capacity that
  wears out. Two of those used to fill every build slot for a full build cycle,
  so a plant that was selling out its output in a market short of supply could
  not order any new capacity until they landed.
- Expansion is now capped by the capacity already on order: no more than two
  growth steps of a plant's running output can be on the way at once. Small
  maintenance orders count for their size and no longer block growth.
- The most a plant can have on the way is unchanged, so this does not let
  companies overbuild faster than before. It stops them under-building in
  retail, health care, real estate and financial services, where most plants
  were stuck behind maintenance orders.
