---
date: 2026-09-06
title: Election spawning split out of its 4,000-line module
summary: >-
  Every country's electoral calendar lived in one file alongside the shared
  engine, so a single-country change meant a diff against the whole thing. The
  engine, the cross-country helpers and each country's calendar now live apart.
tags: [elections, cleanup]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Changed

- `perpetualElections.ts` is now a re-export barrel. Its public surface is
  unchanged, so all eighteen importers are untouched.
- The engine — timers, canonical spawn, duplicate and stale cleanup, batched
  announcements, the game-state snapshot and the orchestrator — lives in
  `perpetualElections/engine.ts`. Helpers used by more than one country live in
  `shared.ts`. Each country's calendar has its own module under `countries/`.
- No behaviour changes. Every declaration moved verbatim; the only edits are
  the `export` keywords the split requires, plus the change below.

## Fixed

- The election game-state snapshot is pinned to `globalThis`. It is an
  `AsyncLocalStorage` that only works if there is exactly one instance, which
  the single-file layout guaranteed for free. Now that the spawners reading it
  sit in sibling modules, a build emitting the engine into more than one bundle
  would have handed readers a different store than the writer, and every
  spawner would have quietly missed the snapshot and fallen back to its own
  database read.
