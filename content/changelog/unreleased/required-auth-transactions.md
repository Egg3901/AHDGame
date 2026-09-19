---
date: "2026-09-10"
title: Require replica-set transactions for coordinated account writes
summary: Add a required-transaction helper for coordinated account writes.
tags: [auth, accounts, backend]
badges: [patch]
areas: [backend]
---

- The new helper gives required transaction callers an active Mongo session and never
  fall back to sequential writes on standalone Mongo.
- Driver-managed transaction and commit deadlines preserve callback and commit
  retry semantics without replaying unknown commit outcomes.

The helper is not yet connected to account deletion routes or workers.
