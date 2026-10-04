---
date: 2026-10-04
title: Supporter benefits reconcile automatically on the hosted worker
summary: >-
  Linked Patreon memberships are checked automatically every six hours so
  supporter benefits stay current. Unmatched memberships are recorded for
  follow-up without changing an unlinked player's benefits.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [supporters, patreon, reliability]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Schedule reconciliation on the hosted background worker with a shared lock to prevent overlapping runs.
- Record run outcomes and unmatched memberships for follow-up while preserving Stripe protections and requiring an exact linked Patreon identity.
- Preserve Stripe ownership on Patreon upgrades and stop benefit writes if a reconciliation loses its shared lease.
