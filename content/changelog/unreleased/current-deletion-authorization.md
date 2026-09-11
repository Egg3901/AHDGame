---
date: "2026-09-10"
title: "Check current account authority before deletion"
badges: [patch]
areas: [backend]
tags: [auth]
---

Account deletion now rechecks the verified session against the current account
before destructive work. Revoked or banned sessions are rejected, and both
admin account flags and roles protect accounts from deletion. Admin deletion
also rejects accounts already locked for login migration. Deletion responses
bypass caches on every outcome.
