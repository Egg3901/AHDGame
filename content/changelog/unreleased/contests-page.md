---
date: 2026-10-09
title: Weekly contests page
summary: >-
  A new Contests page next to Help runs weekly races for corporate growth,
  National Influence and government approval. Each week's leader wins cash,
  and the top three referrers each iteration earn Supporter benefits.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [contests, referrals, community]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Four weekly contests: small business growth, big business growth, National Influence gained, and government approval gained. Rounds last a week and standings update every turn.
- Corporate growth is measured in percent, with capital the owner injects during the round taken out. Corporations are split into small and large at the median opening value so the biggest firms race each other.
- The approval contest counts only while the same player leads the government for the whole round.
- Each round's leader wins cash in personal funds, sized to the world's era. A week where nobody grows pays nothing.
- The referral leaderboard runs all iteration. Staff award the top three Supporter benefits until a chosen date, then the count restarts. Paying supporters keep their own plan.
