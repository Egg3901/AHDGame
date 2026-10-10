---
date: 2026-10-10
title: Keep presidential primary field rows readable on phones
summary: >-
  Candidate names and primary statistics stay readable in the field list on
  narrow screens. Campaign details wrap below the candidate information.
tags: [elections, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- Candidate names wrap between words, with an ellipsis for a single word that cannot fit.
- Candidate share and delegate totals use separate lines, with campaign details below.
