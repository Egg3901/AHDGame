---
date: 2026-10-01
title: Finish reset command connection cleanup
summary: Close the nested database pool when a reset command finishes.
tags: [reset, cli]
badges: [patch]
areas: [backend]
---

- Close both database connections after the reset command finishes, including a pool opened by nested seed helpers.
- Preserve primary connection cleanup when closing the nested connection fails.
