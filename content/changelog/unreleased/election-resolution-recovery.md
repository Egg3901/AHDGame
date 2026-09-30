---
date: 2026-09-30
title: "Keep election holders and retries consistent"
badges: [patch]
areas: [engine]
tags: [elections, germany, reliability]
---

German Bundestag direct and list seats now agree with each holder's current office, including list-only winners and departing representatives. Retrying a finalized election completes candidate cleanup without reseating its winners. Presidential results with pending executive seating return to the presidential resolver. New non-presidential results record the allocator that actually ran for qualification reports.
