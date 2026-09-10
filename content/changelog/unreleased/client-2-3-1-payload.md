---
date: 2026-09-09
title: Slim the local game payload to runtime files
summary: >-
  Singleplayer packaging keeps the standalone server, traced modules, mongodb
  aliases, sharp, static assets and launch script, and fails if source, docs,
  tests or plan markdown still ship.
tags: [client, singleplayer]
badges: [patch]
areas: [backend]
---

## What changed

- Switch `scripts/singleplayer/package.mjs` from a denylist prune to a runtime allowlist.
- Keep `server.js`, `launch.mjs`, traced `node_modules` including generated mongodb aliases, `.next/static`, `public`, `src/data` JSON the server still reads, and the target sharp native.
- Fail the package step when leftover `docs/`, plan markdown, tests, or `src/**/*.ts` exceed a zero budget.
