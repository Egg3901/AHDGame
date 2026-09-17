---
date: 2026-09-12
title: Restore Ask access for migrated client accounts
summary: >-
  Migrated accounts can use their current game session for the Ask sign-in
  handoff. The account-link screen names the mobile or desktop client and
  confirms success only after linking completes.
tags: [client, ask, authentication]
badges: [hotfix]
areas: [fullstack]
---

## What changed

- Validate current unified game sessions during the broker handoff, including
  live session ownership, expiry and revocation checks. Old credentials stay
  rejected after migration.
- Show mobile or desktop wording on the account-link screen, wait for the link
  request, and offer a retry when linking fails.
