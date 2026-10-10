---
date: 2026-10-10
title: Bond repayment warnings look ahead
summary: >-
  Bond repayment notices now estimate whether the company's cash will cover the
  repayment by its due turn, and only demand action when it will not.
tags: [corporations, bonds, ui-ux]
badges: [patch]
areas: [frontend]
---

## What changed

- A bond repayment notice estimates the company's cash at the due turn from what it is currently retaining. If that covers the repayment, the notice is informational and can be dismissed.
- If the estimate falls short, the notice stays dismissible until the last 48 turns before the due turn, then becomes a persistent Action needed alert showing how much is missing.
- When retained earnings are negative or unknown, the notice compares today's cash with the repayment, as before.
