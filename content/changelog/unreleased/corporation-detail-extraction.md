---
date: 2026-09-06
title: Corporation financials maths pulled out where it can be tested
summary: >-
  The three calculations behind the corporation detail page's most persistent
  bugs — realized-vs-nameplate revenue, currency restatement and brand-loyalty
  disclosure — were buried inside a 1,750-line function and could only be
  exercised by loading the whole page.
tags: [corporations, cleanup]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Changed

- The revenue realization ratio, the host-to-corp currency restatement, and the
  brand-loyalty disclosure rule now live in their own modules under
  `corporations/queries/corporationDetail/` and are covered by unit tests.
- No behaviour changes. Each moved verbatim, with the same fallbacks: no
  history or a zero nameplate still means no correction rather than a divide by
  zero, and a state-owned corp still has no private owner for disclosure.

## Why these three first

They are the ones that have actually gone wrong. The realization ratio is the
fix for a page reporting a healthy profit while the chart plotted a loss, and
the currency restatement has to stay exactly the identity for a domestic
sector or every figure on a single-country corp drifts. Both were reachable
only through a full view load, so neither had a test that pinned it.
