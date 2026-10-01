---
date: 2026-10-01
title: Profile redesign experiment
summary: >-
  Some players who allow analytics will see a redesigned version of their own
  profile page. It leads with your office and your numbers, uses one neutral
  palette with your party colour as the accent, and is built to look complete
  before you upload a banner or portrait.
tags: [profiles, ui, experiments]
badges: [minor]
areas: [frontend]
---

## What changed

- The own-profile page (`/profile`) runs the PostHog experiment `profile-redesign`. `control` is the current page and `test` is the new layout. Players without analytics consent always see the current page.
- New header: your office is the headline above your name. Party, state and country are set as text instead of chips. Supporter, Admin and Moderator share one tag style. Share and Edit Profile sit at the top right.
- New Political Standing panel: favorability and actions are shown as large figures, with influence, national influence (with your national rank), infamy and party influence below. Gains and losses keep green and red. Everything else is neutral.
- Under the new layout the rest of the page uses one neutral palette in both dark and light themes, so country themes no longer tint it.
- Other players' profiles, the navigation bar and the footer are unchanged.
