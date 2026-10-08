---
date: 2026-10-08
title: Preserve freight billing when loading older snapshots
summary: >-
  Corporate shipping charges and freight earnings use matching buyer and supplier
  records when loading older sourcing snapshots.
tags: [corporations, logistics]
badges: [hotfix]
areas: [engine]
---

## What changed

- Preserve the saved commodity book's turn so older sourcing snapshots can use
  their matching demand and supply records.
- Continue leaving freight unapportioned when the available records belong to a
  different turn.
