---
date: 2026-09-10
title: Account permissions stay consistent after role changes
summary: Staff access now always reflects the current account record.
tags: [auth, accounts]
badges: [patch]
areas: [backend]
---

- Staff access now always reflects the current account record, including
  after sign-in refreshes and on the account endpoint.
- Ordinary sign-in sessions keep the same fast path; no action needed.
