---
date: 2026-10-08
title: Fix missing regional statistics and targeted ad purchases
summary: Regional statistics handle missing categories, and targeted ads accept valid fractional action balances while guarding insufficient actions.
tags: [bugfix, campaigns, statistics]
badges: [patch]
areas: [frontend, backend]
---

## What changed

- Show the empty state when a region has no metrics in the selected category.
- Preserve fractional action balances when funding targeted ads and reject purchases with insufficient actions.
- Avoid scheduling supporter reconciliation in sandboxes without a creator token.
- Exclude the two market pollers' confirmed React unmount cancellations from error reporting while retaining timeouts and unexpected failures.
