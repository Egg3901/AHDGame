---
date: 2026-10-12
title: Splits no longer move market cap during the split turn
summary: >-
  A stock split or reverse split now keeps the company's market cap level for
  the rest of the turn it happens in, instead of drifting back toward the old
  per-share price.
tags: [corporations, economy]
badges: [patch]
areas: [backend]
---

## What changed

- After a split or reverse split, the between-turn price refresh was still anchored to the share price from before the split. A reverse split dragged the price and market cap down, and a forward split pushed them up, until the next turn. The split now carries through to that anchor as well, so market cap stays where it was.
