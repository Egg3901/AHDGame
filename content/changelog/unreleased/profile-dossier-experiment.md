---
date: 2026-10-01
title: Profile redesign experiment
summary: >-
  Some players who allow analytics will see a redesigned version of their own
  profile page. It reads like a record: who you are and what you hold at the
  top, then each political measure with its value, its change per turn and what
  it means.
tags: [profiles, ui, experiments]
badges: [minor]
areas: [frontend]
---

## What changed

- The own-profile page (`/profile`) runs the PostHog experiment `profile-redesign`. `control` is the current page and `test` is the new layout. Players without analytics consent always see the current page.
- New header: name, then office, then party, state, join date and roles as one line of text instead of chips. Share and Edit Profile sit beside the name.
- New Political Standing table: one row per measure with its value, change per turn and a note on what it does, such as your national rank or what infamy is costing you. Gains and losses keep green and red. Everything else is neutral.
- The new layout uses the site's existing cards, section headings, badges and theme colours, so it follows whichever theme you have selected.
- Other players' profiles, the navigation bar and the footer are unchanged.
