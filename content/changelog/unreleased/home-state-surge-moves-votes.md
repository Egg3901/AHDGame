---
date: 2026-09-04
title: "The home-state surge moves votes"
summary: >-
  Surging your home state charged the fee, spent the actions, marked itself
  used, and changed nothing. The boost it recorded was never read by the
  primary, so the contest ran as though you had not bought it. It now lifts
  you where you paid for it to, on the wave and in the projection alike.
tags: [elections, primaries, president, campaigning]
badges: [patch]
areas: [engine]
era: "Beta 2"
---

Cut from development.

### Fixed

- The home-state surge took your money and your actions, recorded the boost
  against your candidacy, and stopped. Nothing in the primary read what it
  recorded: the wave and the projection were both looking at a different
  field, one the action has never written and that gets cleared at the end of
  every cycle. So the contest ran exactly as it would have if you had never
  surged. The boost now applies where you bought it, in your own home state,
  for the rest of the primary.
- The wave that decides the result and the projection that shows it apply the
  same rule from the same place, so the board cannot promise you a lift the
  count will not deliver.
- A surge already bought keeps the rate it was bought at, and still ends when
  the primary resolves.

Nothing changes for a candidate who has not surged.
