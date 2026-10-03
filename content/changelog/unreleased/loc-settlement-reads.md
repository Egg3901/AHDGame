---
date: 2026-10-03
title: Faster line of credit servicing each turn
summary: >-
  Line of credit interest and payments settle with fewer database reads per borrower, with identical results.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- Each borrower's credit payment record is read three times per turn instead of nine, by reusing what the turn has just read or written.
- Business credit scores for all borrowers who run a company are looked up together instead of one at a time.
- Balances, debts, payments and history entries are unchanged, and an interrupted turn still resumes without charging anyone twice.
