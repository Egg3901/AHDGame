---
date: 2026-10-08
title: Turns get their own server process
summary: >-
  Adds the configuration for a separate server process that runs game turns,
  so updates to the website no longer interrupt a turn in progress.
tags: [turns, reliability]
badges: [patch]
areas: [backend]
---

## What changed

- Adds the deploy configuration for a dedicated turn process. Once it is switched on, website updates no longer restart the server running a turn, which had occasionally interrupted turns and delayed them.
