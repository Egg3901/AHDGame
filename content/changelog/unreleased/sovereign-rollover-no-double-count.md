---
date: 2026-10-08
title: Government debt no longer grows when bonds are rolled over
summary: >-
  When government bonds came due, the market exchanged most of them for new
  bonds and the treasury also borrowed the same amount again in advance. That
  counted the same debt twice and let national debt climb faster than the
  deficit. Governments now only borrow ahead for the part of a maturing bond
  that actually has to be paid in cash.
tags: [economy, bonds, government]
badges: [patch]
areas: [backend]
---

## What changed

- Quarterly rollover borrowing now excludes the share of maturing bonds the market takes in kind at par.
- National debt growth now tracks the budget deficit instead of the size of the maturing bond ladder.
- Treasuries stop piling up idle cash raised for bonds that never needed to be repaid in cash.
