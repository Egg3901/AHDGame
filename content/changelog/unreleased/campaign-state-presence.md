---
date: 2026-09-04
title: "Getting to a state, and the levers listed once"
summary: >-
  Travelling to a state was a working mechanic with no button anywhere, so
  canvassing outside your home state was gated behind an instruction you had
  no way to follow. The campaign manager now shows where you are and lets you
  move, right above the canvassing it unlocks. The operations levers, which
  appeared three times on one page, appear once.
tags: [campaigns, elections, president, campaigning]
badges: [minor]
areas: [fullstack]
era: "Beta 2"
---

Cut from development.

### Added

- Where you are campaigning, on the campaign manager: camp in a state and
  surge your home state while the primary runs, travel to a state once it is
  over. It sits directly above canvassing, because being somewhere is what
  canvassing needs.

### Fixed

- Travelling to a state had a working action behind it and a real effect each
  turn, but nothing on any page could trigger it. Canvassing away from home
  told you to travel to a state and gave you no way to do so.
- The campaign manager and the primary screen quote the same price for the
  same journey, from one list of states, and use the same picker to choose one.
- The four operations levers were listed three times on the campaign manager,
  and two of those listings disagreed: one counted the starter unlock and the
  other did not, so the same lever read 0 of 10 in one place and 0 of 9 a
  little further down. They are listed once now, and the row you spend on says
  what the next tier buys and what it costs, which the bare plus button never
  did.
