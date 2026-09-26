---
date: 2026-09-26
title: Resolve party IDs on the Politicians page
summary: >-
  Politicians with a party stored as a database ID now show the party name and color
  in the roster and party filter instead of exposing that ID.
tags: [politics]
badges: [patch]
areas: [backend]
---

## What changed

- Resolve party records by both their public number and database ID when building the Politicians roster.
