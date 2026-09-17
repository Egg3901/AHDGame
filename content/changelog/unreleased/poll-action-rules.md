---
date: 2026-09-17
title: Shared Poll rules
summary: Poll action costs share a portable rules module across quote, debit and display.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- Quick and full poll quotes, effects and the poll API route use the same portable AP and intellect-scaled fund-cost rules. Existing balance, flat 2/6 AP costs and the intellect cost curve are preserved.
- The poll route debits the quoted intellect-scaled cost instead of a flat copy, and the poll page displays the quoted per-tier costs. Validation rejects unallocated intellect with the quoted reason instead of substituting the unscaled base.
