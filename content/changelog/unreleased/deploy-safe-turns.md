---
date: 2026-09-06
title: A server update no longer costs you a whole turn
summary: >-
  When the game updates while a turn is being processed, that turn used to be
  abandoned: the handful of things it had already done stood, and everything it
  had not reached yet, elections included, simply never happened. It now picks up
  where it left off.
tags: [turns, reliability]
badges: [patch]
areas: [engine]
---

## What changed

- A turn interrupted by a server update now resumes. It skips the work that
  already completed and carries on with the rest, instead of the whole turn being
  written off.
- The one piece of work that was actually in progress when the interruption hit is
  skipped too, because it may have half finished and doing it twice would be worse
  than not finishing it.
- The game no longer waits twenty minutes before picking a stalled turn back up
  when it already knows the process behind it has gone. That wait was costing a
  second turn on top of the interrupted one.

## Why it matters

A turn is about a hundred and fifty separate pieces of work. An update landing a
few seconds into one used to discard almost all of them, so an hour's turn could
pass with no elections resolved and no results recorded. The cost of an update
landing at a bad moment is now a few seconds of work rather than an hour of it.
