---
date: 2026-10-10
title: Honeymoon for new leaders and a fairer empty cabinet penalty
summary: >-
  The public expectations drag on national approval now builds up over a new
  leader's first turns, and the empty cabinet penalty scales with how many
  seats are empty.
tags: [approval, cabinet]
badges: [patch]
areas: [fullstack]
---

## What changed

- Higher public expectations no longer hit a new head of government at full strength on day one. The drag starts at zero when they take office and builds up to the full 5 points over 48 turns. A change of leader starts the honeymoon again.
- The empty cabinet penalty is now a sliding scale instead of all or nothing. It is 7.5 points times the share of cabinet seats that are empty, so a cabinet with 3 of 8 seats empty costs about 2.8 points and a full cabinet costs nothing. An acting secretary still fills a seat, and still carries its own 0.5 point acting penalty.

Leaders already in office when this ships keep the full expectations drag until the next change of leader.
