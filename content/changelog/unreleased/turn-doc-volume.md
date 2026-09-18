---
date: 2026-09-18
title: Trim repeated scans out of the hourly turn
summary: >-
  Two hot paths re-did work proportional to a list they could have indexed
  once: trade affinity scanned every active embargo on every trade lane, and
  supply-agreement delivery re-scanned the whole contract book once per scope.
  Both now resolve their input once per turn.
tags: [trade, corporations, economy, performance]
badges: [patch]
areas: [engine]
---

## What changed

- `buildTradeAffinity` indexes active embargoes by directed `source|target` pair
  once, instead of running a `some`/`for` over the full list on every
  `affinityFor` / `capUnitsFor` call. Block and cap embargoes, and the
  `export` / `import` / `both` directions, stay in separate indexes so the
  predicate is unchanged.
- `allocateDeliveriesToBuyers` buckets supply agreements by scope once, instead
  of re-scanning (and re-deriving `scopeOf` for) the whole book inside a loop
  over every scope. Each scope's flow graph is independent, so the result is
  unchanged.
- Tests pin the embargo direction handling, the `all` commodity wildcard, and
  the smallest-cap-wins rule across directions.

## Why it matters

Both were cost proportional to list size where a lookup would do. The clearing
engine calls the affinity helpers once per commodity/exporter/importer triple
against an embargo list that runs to thousands of documents in a mature world,
and the delivery flow ran O(scopes × agreements) over a contract book of the
same order. A CPU profile of a real turn measured `embargoMatches` at 2.1 s of
self time and `allocateDeliveriesToBuyers` at 1.1 s; after the changes neither
scan remains.
