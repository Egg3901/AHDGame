---
date: 2026-10-02
title: The influence dossier now shows the most one play can buy
summary: >-
  The nation dossier on an organisation's Influence tab now says that one
  play lands at most 10 points, warns when an amount goes past that, and
  explains how a rival's push cancels yours before the turn limit applies.
tags: [international-organizations, alignment, influence]
badges: [patch]
areas: [frontend, backend]
---

## What changed

- The amount preview stops at one play's cap of 10 points (5 on a nation that resists at half strength) and says how much of the amount would be wasted. Before, it stopped at the 5 point turn limit and said the extra could still count against a rival, which was not true past 10.
- The price line explains that opposing pushes cancel point for point before the turn limit applies, and that a second play on the same nation in the same turn adds its own 10 points.
- While a flashpoint is open on a nation, the turn limit and its cost use the raised flashpoint limit instead of the usual 5.
- When none of a nation is uncommitted, the preview says a point raises your share by less than one, because a gain is shared out across every side.
