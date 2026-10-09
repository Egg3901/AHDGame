---
date: 2026-10-09
title: Reviewed tax bills retain their exact rates
summary: "Reviewed tax legislation carries the selected rate through proposal, estimates and enactment instead of losing the exact setting."
tags: [legislation, taxes]
badges: [patch]
areas: [fullstack]
---

## What changed

Reviewed tax legislation carries the selected rate through proposal, estimates and enactment instead of losing the exact setting.

## Developer detail

National, regional and cabinet proposal paths resolve reviewed provisions through the shared tax catalog. Guided forms and estimates follow the selected exact rate. Regional validation and provision display have a separate existing note. References: commit 23b44cdc26; related follow-up 8931708eda.
