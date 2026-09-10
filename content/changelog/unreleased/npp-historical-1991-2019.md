---
version: "1.4.65"
date: 2026-09-10
title: 1991 and 2019 presets seat real historical NPPs with ages and V5 mortality
summary: >-
  Every seated NPP in the 1991 and 2019 presets is now a real historical
  office-holder with a verified birth year and portrait where findable.
  Under V5 rules they age, die (Gompertz mortality), and are replaced by
  new random NPPs from the same party.
tags: [npp, historical, presets]
badges: [minor]
areas: [engine]
---

## What changed

- Historical rosters for all seated NPPs in 1991-default (1015 seats) and
  2019-default (1004 seats): US, UK, JP, DE, CN, IE.
- Real names with Wikidata/EN/JA-Wikipedia-verified birth years; duplicate
  keys resolved so every seat holds a distinct person.
- 480+ portraits appended to the politician image pool (canonical
  upload.wikimedia.org URLs).
- V5 gating: historical NPPs age each turn and die by Gompertz mortality,
  with same-party random successors (see `src/lib/npp/mortality.ts`).
- Region-flex assignments documented per entry where a seat is filled by a
  real politician from outside its exact district (e.g. national-list
  upper-house members, ex-Diet members on regional councils).
