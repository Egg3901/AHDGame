---
date: 2026-09-25
title: Reduce bank reads during corporation turns
summary: Corporation decisions reuse one projected central bank rate snapshot for plant pricing and relocation credit quotes.
tags: [corporations, performance]
badges: [patch]
areas: [engine]
---

- Corporation decisions read the bank IDs and prime rates once per turn phase instead of repeating the bank query for each country and relocation credit quote.
- Relocation credit previews outside the turn still load current bank rates.
- Credit eligibility, quote calculations and player actions are unchanged.
