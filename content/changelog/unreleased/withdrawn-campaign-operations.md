---
date: 2026-09-15
title: Withdrawn candidates leave Campaign Operations
summary: >-
  A candidate who withdraws no longer appears in a race's Campaign Operations
  list, and their campaign stops drawing income while they are out.
tags: [campaigns, elections, withdrawals]
badges: [patch]
areas: [fullstack]
---

## What changed

- Withdrawing from a race now removes the candidate from that race's Campaign
  Operations list in every case. Previously this only worked when the candidate
  pressed Withdraw themselves: leaving through a party switch, a relocation, a
  long absence, or a deleted character left the campaign on display next to the
  candidates still running.
- The list is now built from who is actually standing in the race, so a campaign
  can no longer linger there.
- A campaign that has been set aside no longer collects funds or actions each
  turn. It keeps everything it had, and re-entering the race restores it intact.
