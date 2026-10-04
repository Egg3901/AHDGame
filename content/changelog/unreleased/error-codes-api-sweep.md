---
date: 2026-10-05
title: Consistent error responses across the API
summary: >-
  Failed requests across the game API now return the same error shape with a
  code and reference id.
tags: [errors, support]
badges: [patch]
areas: [backend]
---

## What changed

- About 850 API routes now answer failures with a shared error shape: the message, a stable error code, and a reference id.
- Messages are unchanged, so existing screens keep working while support can trace a failure from its reference id.
