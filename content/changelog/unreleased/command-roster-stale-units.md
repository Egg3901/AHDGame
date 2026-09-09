---
date: 2026-09-08
title: Keep military commands editable after unit removal
summary: >-
  Military commands no longer fail to save because they still reference units
  absent from the country's roster. Current assignments and local edits are preserved.
tags: [military, commands]
badges: [patch]
areas: [frontend]
---

## What changed

- Remove stale unit assignments from command saves, including when the roster refreshes while editing.
- Preserve current units, command settings and read-only access restrictions.
