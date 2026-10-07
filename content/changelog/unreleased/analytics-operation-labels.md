---
date: 2026-10-07
title: Add bounded gameplay operation diagnostics
summary: >-
  Optional gameplay analytics can now distinguish selected party operations
  and requested character actions without collecting request text or URLs.
tags: [analytics, privacy]
badges: [patch]
areas: [frontend]
---

## What changed

- Add fixed operation labels to acknowledged action success and rejection events.
- Distinguish national and regional party influence, selected party operations, and allowlisted character action requests.
- Keep unknown operations explicit and preserve existing event and rejection semantics.
