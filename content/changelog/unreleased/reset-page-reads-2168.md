---
date: 2026-09-20
title: Election pages skip the 31KB stance maps; market page loads tabs on demand
summary: >-
  Opening the elections page no longer pulls every candidate's full policy
  stance map out of the database just to draw name-and-avatar summary cards,
  and the stockmarket page no longer fetches auction data until you open the
  Auctions tab.
tags: [elections, stockmarket, performance]
badges: [minor]
areas: [fullstack]
---

## Changed

- Election summary views (the country elections page and `view=summary` API
  responses) now project their database reads: NPP lookups omit the
  `policies.domainPositions` stance map, character lookups fetch only the
  display and scoring fields the summary cards use, and the game-state read
  fetches the three fields summary enrichment consumes. Detail views are
  unchanged and still load full documents.
- The stockmarket page defers the privatization-auctions fetch until the
  Auctions tab is selected instead of firing it on every page visit. The tab
  badge fills in once the tab is opened; listings, which feed the always
  visible stats strip and ticker, still load up front.
