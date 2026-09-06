---
date: 2026-09-06
title: Covert nuclear programmes no longer survive a world reset
summary: >-
  The covert nuclear programme collection was never classified in the seed
  manifest, and the reset sweep is manifest-driven, so every prior campaign's
  programme stayed on disk. A fresh world could open with a country already
  part-way to breakout.
tags: [military, cleanup]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Fixed

- `covertNuclearPrograms` is now classified `runtime` in `SEED_MANIFEST`.
  `resetGameWorld` wipes `getRuntimeCollectionNames()`, so an unclassified
  collection is invisible to the sweep: per-country stage, progress, funding,
  suspicion, exposure count and breakout turn all carried across resets.

## Added

- A manifest-coverage test that walks the other way from the existing reset
  tests. Those iterate the manifest, so they can only check what is already
  classified; this one reads the collection-name constants declared under
  `src/lib/db/collections/` and requires each to carry a classification, which
  is what makes an omission fail the gate instead of passing silently.
