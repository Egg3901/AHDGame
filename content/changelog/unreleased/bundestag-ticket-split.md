---
date: 2026-09-06
title: Bundestag second votes stop being a copy of the first votes
summary: >-
  The ticket-split layer was keyed on a retired demographic vocabulary, its
  rate table named parties that exist in no seed, and it was never reached
  anyway — so every Land's second-vote total came back identical to its first.
  Split-ticket voting now works, with era-appropriate rates.
tags: [elections, germany]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Fixed

- Second votes now differ from first votes. The crossover layer was called
  without a demographic breakdown, fell through to a default bucket that had no
  authored rules, and returned the first-vote totals unchanged in every Land.
- The rate table is now party-to-party rather than archetype-keyed. That is
  both what the vote tally can actually support — it stores totals per
  candidate and nothing per demographic bucket — and how ticket splitting is
  measured in practice.
- Rates are era-scoped, because the behaviour was. Splitting was marginal in
  1953, one election into the two-vote ballot; the Leihstimme that keeps a
  junior coalition partner over the threshold is a 1961-onward habit and the
  modern table reflects that.

## Removed

- The old placeholder table. Two of its five archetype ids appeared nowhere
  else in the codebase, and every rule targeted party ids that no seed defines
  — three of them parties that did not exist in 1953.
