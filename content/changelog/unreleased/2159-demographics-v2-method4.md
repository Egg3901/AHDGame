---
date: 2026-10-07
title: A more responsive electorate model for future worlds
summary: >-
  Admins can select Demographics v2 for a future 1991 reset. It connects the
  live population to voter age composition and lets race closeness, issue
  contrast and ballot access shape turnout through an explainable ledger.
tags: [demographics, elections, turnout, admin]
badges: [minor]
areas: [engine, frontend]
---

## What changed

- The Admin Panel now has a reset-scoped Demographics v1 or v2 selector. Existing and newly reset v1 worlds keep today's behavior.
- V2 builds voter age shares from the same live age and sex population stock used by births, deaths and migration. Aging now changes who is in the electorate, not only how large it is.
- V2 turnout starts from each group's established participation habit, then records separate effects for issue salience, race competitiveness, ballot access, campaign contact and saturation.
- V2 makes strongly contested economic or social differences matter more to voter choice while keeping the existing ideology scale and bounded effects.
- Canvassing now appears as its own turnout effect in v2, with repeated contact gradually losing efficiency. The election page explains every turnout term, and the Campaign Room recommends whether to canvass or persuade a weak group next.
- Each country uses a named, versioned calibration pack, so balance changes can be simulated and reviewed without changing the portable rules.
- The reset validates the required live population vectors before certifying v2. Missing data falls closed to v1 rather than partially activating the new model.
