---
date: 2026-09-18
title: Resolve trade embargoes through a directed index
summary: >-
  The clearing engine asked "does an embargo block this flow?" by scanning the
  whole active embargo list on every trade lane, every turn. It now reads a
  lookup built once per turn — the same answer for a fraction of the work.
tags: [trade, economy, performance]
badges: [patch]
areas: [engine]
---

## What changed

- `buildTradeAffinity` indexes the active embargoes by directed `source|target`
  pair once, instead of running a `some`/`for` over the full list on every
  `affinityFor` / `capUnitsFor` call.
- Block and cap embargoes, and the `export` / `import` / `both` directions, stay
  in separate indexes so the predicate is unchanged.
- Tests pin the direction handling, the `all` commodity wildcard, and the
  smallest-cap-wins rule across directions.

## Why it matters

The clearing engine calls these helpers once per commodity/exporter/importer
triple, and the active embargo list runs to thousands of documents in a mature
world, so the scan was pure per-lane overhead. A CPU profile of a real turn
measured `embargoMatches` at 2.1 s of self time; after the change the function
is gone and trade affinity no longer registers in the profile.
