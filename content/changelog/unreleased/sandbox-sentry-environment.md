---
date: 2026-10-04
title: Separate sandbox error reports
summary: Keep sandbox errors identifiable when deployments share a hosting environment.
tags: [observability]
badges: [patch]
areas: [backend, frontend]
---

- Support an explicit error-reporting environment across the server, edge and browser.
- Keep the existing environment defaults when no override is configured.
