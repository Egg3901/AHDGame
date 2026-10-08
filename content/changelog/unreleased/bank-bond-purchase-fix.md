---
date: 2026-10-08
title: Bank bond purchases complete again
summary: >-
  A bank that bought government bonds with spare cash could not take delivery
  of them, which stopped every bank's turn from finishing.
tags: [banking, bonds, fix]
badges: [fix]
areas: [backend]
---

## What changed

- When a bank invested spare cash in government bonds, the bonds never reached the bank's books, and the banking step of each turn stopped there for every bank. Bank bond purchases now complete, the purchase that was stuck finishes on the next turn, and banks resume paying deposit interest and servicing loans.
