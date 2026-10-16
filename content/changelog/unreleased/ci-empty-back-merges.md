---
date: 2026-10-15
title: Check empty back-merges without repeating the full suite
summary: >-
  Use content checks for unchanged main back-merges into development or staging,
  while retaining the full suite when change detection fails.
tags: [ci]
badges: [patch]
areas: [backend]
---

## What changed

- Route empty same-repository main back-merges through the existing content checks.
- Keep full checks for failed change detection and other empty changes.
- Preserve existing promotion and qualification checks.
