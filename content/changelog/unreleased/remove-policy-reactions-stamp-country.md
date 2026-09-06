---
date: 2026-09-06
title: Dead policy-reactions phase removed, state policies stamped with their country
summary: >-
  Policy reactions were written on every enactment and decayed by a turn
  phase that nothing ever read; the live collection was empty. The module,
  phase and type are gone. State policy rows now carry the enacting country.
tags: [legislation, cleanup]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development. PR #1493.

## Removed

- `src/lib/policyReactions.ts`, the `policyReactionDecay` turn phase, the
  `PolicyReaction` type and the `policyReactions` seed-manifest entry. The
  collection had zero documents on the live world because no seeded
  legislation type carries group approvals, and no reader ever existed.

## Changed

- `statePolicies` rows written by enactment now carry `countryId`. The
  upsert key stays `(stateId, legislationTypeId)` so existing rows are
  matched; the field is there so a future seed reusing a region abbreviation
  cannot collide two countries' policies.
