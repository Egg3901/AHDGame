---
date: 2026-10-15
title: Admin player search covers all accounts
summary: >-
  Admin and moderator player searches now cover the full account directory,
  and Patreon management resolves the character selected by the operator.
tags: [admin, player-search]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Paginate player directories in Achievements, Account Dossier, and Forensics.
- Resolve Patreon updates against the exact selected character.
- Expand the Players table to 2,000 accounts and disclose when more exist.
