---
date: 2026-09-18
title: Trim repeated work out of the hourly turn
summary: >-
  Three hot paths re-did work proportional to a list they could have indexed
  once: trade affinity scanned every active embargo on every trade lane, the
  supply-agreement delivery flow re-scanned the whole contract book once per
  scope, and the round-trip profiler re-parsed its own trace id on every Mongo
  command.
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
- The round-trip profiler caches the phase it last resolved from a turn trace
  id, and takes the phase name after the second colon instead of splitting and
  rejoining the string. It runs on every Mongo command, and the trace id changes
  once per phase, not once per command.
- Tests pin embargo direction handling and the smallest-cap-wins rule, and cover
  the profiler's trace-id cache across a phase change.

## Why it matters

All three were cost proportional to list or command count where a lookup would
do. The clearing engine calls the affinity helpers once per
commodity/exporter/importer triple against an embargo list that runs to
thousands of documents in a mature world; the delivery flow ran
O(scopes × agreements) over a contract book of the same order; and the profiler
ran its string work once per command, tens of thousands of times a turn. A CPU
profile of a real turn measured `embargoMatches` at 2.1 s and
`allocateDeliveriesToBuyers` at 1.1 s of self time; after the changes neither
scan remains.
