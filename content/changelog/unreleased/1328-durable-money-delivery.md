---
date: 2026-09-30
title: Durable cash delivery acknowledgements
summary: >-
  Banking transfers retain their delivery outcomes until the settlement journal
  acknowledges them, and recovery preserves the original guarded result.
tags: [banking, economy]
badges: [patch]
areas: [engine]
---

## What changed

- Cash delivery and its protected receipt are written together and reconciled before releasing the receipt.
- Recovery can finish another waiting command's cash acknowledgement without repeating its transfer.
- Older interrupted transfers with no surviving delivery evidence remain visible for reconciliation.
