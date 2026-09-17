---
date: 2026-09-17
title: See where you built campaign presence this turn
summary: Campaign Presence now marks states already invested in during the current turn.
tags: [elections]
badges: [patch]
areas: [fullstack]
---

## What changed

- The campaign hub and Political Operations show which states have already received a presence build this turn.
- New builds record the funds actually paid, shown beside the current-turn marker. Older builds without a receipt keep their marker without an estimated amount.
- Already-built states cannot be selected again. Markers use the same turn boundary as the server limit.
