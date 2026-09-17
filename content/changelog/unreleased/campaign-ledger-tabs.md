---
date: 2026-09-15
title: See who is backing your campaign, and every action you have taken
summary: >-
  The campaign ledger now has two tabs. Activity keeps the full history of what
  you bought rather than only the last ten entries, and a new Endorsements tab
  lists everyone currently backing you, filterable by players or politicians.
tags: [campaigns, ledger, endorsements]
badges: [minor]
areas: [fullstack]
---

## What changed

- The ledger is now two tabs. **Activity** is the log you already had, and
  **Endorsements** lists the players and politicians actively backing the
  campaign.
- The activity log keeps a campaign's whole history instead of only the ten most
  recent entries, so its pager finally has more than one page to turn.
- Endorsements can be narrowed to players or to politicians, and each chip
  carries the number sitting behind it. Both tabs page ten at a time.
- Endorsement rows name the endorser and whether they are a player or a
  politician. They carry no "when": endorsement records store no turn number,
  and the only timestamp on them is a real-world one that would read oddly
  beside the game's own calendar. It still orders the list, newest first.

## Notes

History starts building from this release forward. Entries already trimmed away
cannot be recovered, so a campaign that has been running a while will fill its
first page before it fills a second.
