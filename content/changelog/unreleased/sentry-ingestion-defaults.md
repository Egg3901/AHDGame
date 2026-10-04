---
date: 2026-10-05
title: Fix error reporting setup
summary: >-
  Error reports from the browser are no longer dropped when only the server
  reporting address is configured, and the reporting organization is now correct.
tags: [reliability, observability]
badges: [patch]
areas: [fullstack]
---

## What changed

- Browser error reporting now reuses the server reporting address when no separate public one is set.
- The default error tracking organization was corrected so source maps and the admin issue feed point at the right place.
- The server logs one line at boot saying whether error reporting is enabled or why it is not.
