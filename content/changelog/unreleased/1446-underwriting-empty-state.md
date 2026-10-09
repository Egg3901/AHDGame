---
date: 2026-10-09
title: Clearer underwriting bank list when none qualify
summary: >-
  The primary underwriting picker now explains why it is empty when no
  investment or universal bank is chartered in the corporation's currency, and
  points corporate loans to the Banking page.
tags: [banking, corporations]
badges: [patch]
areas: [frontend]
---

## What changed

- When no bank can underwrite in a currency, the picker is disabled and says that retail banks do not underwrite and that placements still sell without a mandate.
- The same note links to the Banking page, where corporate loans from private banks are arranged.
