---
date: 2026-09-20
title: Turn startup and health snapshot read less data each turn
summary: >-
  Starting a turn loaded every character and state document in full, and the
  hourly health snapshot pulled full budget, bank, and metrics documents plus
  unprojected join inputs through its integrity checks. Turn startup now reads
  only the fields its phases consume, and the snapshot projects its lookups
  and budget reads. Counts and detection behavior are unchanged.
tags: [turn, performance, health snapshot]
badges: [patch]
areas: [engine]
---

## Fixed

- Turn initialization projects the character and state reads to the fields the
  turn phases consume instead of deserializing full documents.
- Health snapshot integrity checks project to join keys before their lookups,
  and the economy collector projects its central bank, metrics, and federal
  budget reads. Orphan and mismatch counts are unchanged.
