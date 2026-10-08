---
date: 2026-10-08
title: Corporate credit ratings are labelled as leverage ratings
summary: >-
  A company's AAA-to-CCC rating measures how much debt it carries and how
  safely it can service it, not whether it is making money. The corporation
  pages now call it a leverage rating and explain that a company with no debt
  rates AAA even when it is losing money.
tags: [corporations, ui]
badges: [patch]
areas: [frontend]
---

## What changed

- The corporation overview, financials, masthead and credit tab now say
  "Leverage rating", with a tooltip explaining what the rating measures.
- The corporations guide explains that debt carries most of the weight, so the
  rating reads as borrowing safety rather than company health.
- The rating formula itself is unchanged.
