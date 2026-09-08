---
date: 2026-09-08
title: There is now a limit on how much one member can take from party funds each turn
summary: >-
  Party money could leave a treasury as fast as an officer could click, and a
  single transfer could empty one. There is now a per-turn ceiling on what any
  one member can receive, counted across the national treasury, state parties and
  caucuses together, and no party money moves at all in the last two turns before
  a leadership election closes.
tags: [parties, treasury, security]
badges: [minor]
areas: [backend, frontend]
---

## What changed

- A member can now receive only so much from party funds in a single turn. The
  ceiling is 2,000,000 in the United States and the United Kingdom, 1,500,000 in
  the Soviet Union and East Germany, and 10,000,000 in Japan.
- That ceiling counts every source together: the national treasury, every state
  party and every caucus. Being paid from a state party uses up the same
  allowance as being paid nationally, so the limit cannot be collected once per
  treasury.
- No party funds move at all during the last two turns before a party leadership
  election closes. That covers sends, transfers to state parties, caucus
  payments, and approving a request that was queued earlier.
- The limits are written on the Send to Member, Request Funds, state party and
  caucus panels, so you can see them before you try to spend.
- Refusals say how much of the allowance is left rather than simply failing.

## Why it matters

Nothing previously limited the speed at which party money could leave. An
officer could move an entire treasury in one click, and the first anyone else
knew of it was the balance afterwards. A ceiling per turn does not decide who
deserves the money, which is a political question for the party, but it does mean
a large sum can no longer leave quietly in one movement: it becomes hours of
visible activity that other members can see and respond to.

The two turns before a leadership election are the moment an outgoing officer has
both the most reason to move money and the least accountability for it, so
nothing moves then at all.
