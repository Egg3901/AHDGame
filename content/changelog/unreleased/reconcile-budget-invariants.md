---
date: 2026-09-06
title: A country's surplus is now the same number everywhere it is used
summary: >-
  The stored figure for a nation's surplus and its debt principal could drift
  away from what the underlying revenue, spending and treasury actually said.
  That drifted figure was deciding whether a treasury transfer breached the debt
  ceiling and how much sovereign debt to issue each quarter. Both now read the
  real number, and the stored copies are corrected at the end of every turn.
tags: [budget, treasury, bonds]
badges: [patch]
areas: [engine]
---

## What changed

- The debt-ceiling check on a treasury transfer, and the size of each quarter's
  sovereign bond issue, are worked out from a country's actual revenue and
  spending rather than from a stored copy that could be out of date.
- At the end of every turn, the stored surplus and debt principal are corrected
  to match what the books say.
- If a stored figure is wildly out rather than slightly out, it is reported and
  left alone, because that means something upstream is wrong and quietly
  rewriting it would hide the fault.

## Why it matters

Surplus is not a number in its own right. It is revenue minus spending, and debt
principal is whatever the treasury is overdrawn by. Both were kept as copies that
each part of the game updated for itself, so they could fall out of step within a
year. That was known and treated as a cosmetic problem on the grounds that the
pages people read work it out for themselves.

They do not all work it out. A stale copy was deciding whether your treasury
transfer was allowed, and how much debt your country issued.
