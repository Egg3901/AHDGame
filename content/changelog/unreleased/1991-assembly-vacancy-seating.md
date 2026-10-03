---
date: 2026-10-01
title: Fill Russian Assembly vacancies within their original terms
summary: >-
  Failed Duma and Council polls can repeat after the Assembly takes office.
  New winners fill their mandates without replacing held offices or extending
  the original chamber terms.
tags: [1991, russia, elections]
badges: [patch]
areas: [engine]
---

## What changed

- Bind post-handover repeats to the original seating journal and chamber term.
- Move a successful list deputy to their constituency and fill the released list allocation atomically.
- Seat protected winners after their residence choice while preserving their accounts and preventing duplicate mandates.
- Preserve held offices, government roles and lawful vacancies; keep ended mandates from returning automatically.
- Keep Council profiles out of Duma NPC slates and protect existing constituency winners during certification.
