---
date: 2026-10-10
title: The national approval page now shows how the headline adds up
summary: >-
  The national approval figure is broken into the population-weighted state
  average and each national adjustment, so the numbers reconcile.
tags: [approval, country]
badges: [patch]
areas: [frontend]
---

## What changed

- The Government approval card lists the state average, each national adjustment (such as public expectations or an empty cabinet) with its value, and the final national figure.
- The subtitle no longer claims the headline is only the average of state approval.
- Regional conditions are labelled as already included in the state numbers and are no longer netted together with the national adjustments.
- Tiny effects, such as a bank backstop worth a fraction of a hundredth of a point, are rounded and hidden instead of showing a long decimal.
