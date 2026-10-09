---
date: 2026-10-08
title: Election night for the presidency, one electoral map, and contingent elections explained
summary: >-
  The last hour of a US presidential race now plays out as election night:
  the board clears, states report in poll-closing order, and calls land only
  when they cannot be reversed. The race page has one interactive electoral
  map with state and county detail, and a House-decided presidency is named
  and explained.
tags: [elections, president, maps, interface]
badges: [major]
areas: [fullstack]
---

## What changed

- Election night: during the final hour of a US presidential race the page becomes a live broadcast. Every state starts grey, polls close in real-world order on an election-night clock, early counts stay fogged, and a state is projected only once its lead survives anything the last turn could add. Called electoral votes, the next poll closing, a feed of calls and the key races update as results come in, then the board settles on the resolved result.
- One electoral map replaces the battleground board and the second map further down the page. It stays still while you scroll; tap the lock to pan and zoom. Select a state for its leader and margin, each ticket's share and change since last turn, which way the race is moving, and county results.
- The tickets and campaign operations are one table: electoral votes, share, votes, funds, actions, levels, endorsements and a link to each campaign.
- Desktop rails sit at the screen edges so the race gets the full width; on phones the side panels open from a chip row.
- Contingent elections: when no ticket has an electoral majority, the warning appears once, beside the college bar, and shows how the House and Senate ballots would go with the Congress being elected now. Results for a House-decided presidency now name the president the House elected, not the popular-vote leader.
