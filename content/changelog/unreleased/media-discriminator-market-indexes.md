---
date: 2026-10-04
title: Prepare media taxonomy identity indexes
summary: >-
  Install the media-lane compound indexes before the later fresh-1991 seed
  conversion, with no writes to existing market documents.
tags: [media, taxonomy, migration]
badges: [patch]
areas: [engine]
---

## What changed

- Added an idempotent, registered startup migration for corporate sector, unowned market, and seeded union identity keys that include the media discriminator.
- Build replacement unique indexes before removing the prior equivalent guards. Existing media and entertainment rows are not re-keyed or repaired.
- Bootstrap and seed index setup use the same discriminator-aware identity keys before dependent canonical seed work.
