---
date: 2026-10-01
title: Preserve selected party rosters through world reset
summary: Reset cleanup retains the party roster selected for each registered country.
tags: [seeds, parties, reset]
badges: [patch]
areas: [backend]
---

## What changed

- Reset cleanup preserves the existing fallback roster for a country without a separately authored era roster.
- Countries absent from the era and obsolete parties remain excluded.
- Party identities and membership links survive the final reset cleanup.
