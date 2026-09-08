---
date: 2026-09-08
title: Committee-only leadership elections no longer stop members standing for a seat
summary: >-
  A party set to committee-only leadership elections hid the Run button from
  every member outside the committee, with nothing on screen to say why. The
  setting is meant to decide who votes, not who runs, and the server always
  allowed the candidacy. Any member may now stand, the committee still casts the
  ballots, and the panel explains the split.
tags: [parties, elections, leadership]
badges: [patch]
areas: [fullstack]
---

## Fixed

- Members of a party using committee-only leadership elections can now stand for
  chair, vice chair and treasurer. The Run button was previously hidden from
  anyone outside the committee, even though the election method is only meant to
  decide who votes.
- Small parties were hit hardest. With an empty committee the only eligible
  person was whoever already held a seat, so nobody else could contest a race.

## Changed

- Committee members and national leadership remain the only people who vote in
  these races. That has not changed.
- The election panel now says plainly that you can stand for a seat while only
  the committee votes, instead of quietly showing no buttons.
