---
date: 2026-10-01
title: Start native Russian Assembly campaigns after political consent
summary: >-
  Ratified Russian Assembly decisions now start their first campaigns and
  dedicated NPC slates during the turn. Failed polls repeat within the original
  chamber terms while successful mandates and lawful vacancies remain intact.
tags: [1991, russia, elections]
badges: [patch]
areas: [engine]
---

## What changed

- Open both first Assembly election families after the eligible date and actual political consent.
- Admit Duma slates before Council slates so their individual nominees use separate NPC profiles and existing accounts.
- Resume interrupted admission, repeat only failed polls and preserve alternate settlements in existing saves.
- Keep bound Assembly ballots out of generic candidate admission and single-race seating.
- Track the campaign phase separately and qualify its full native journey in the transaction gate.
