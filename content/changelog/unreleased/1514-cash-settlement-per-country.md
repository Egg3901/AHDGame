---
date: 2026-10-13
title: One country's treasury problem no longer stalls every other Cabinet treasury
summary: >-
  National cash settlement on the Cabinet finance system now runs each country
  on its own, so bad data in one country holds back only that country's
  treasury and departments.
tags: [economy, government, fix]
badges: [patch]
areas: [engine]
---

## What changed

- Each turn the game pays revenue into every national treasury on the Cabinet finance system and funds that country's departments from it. Until now one country with a broken record stopped this step for all of them, so a single stuck budget line could leave every country's treasury and departments unpaid turn after turn.
- Countries now settle independently. A country with a problem is held back and reported, while every other country is paid and funded as normal.
- Retrying a turn never pays a country twice.
