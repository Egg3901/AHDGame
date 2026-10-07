---
date: 2026-10-07
title: Stop free challenger recruitment in player countries
summary: Empty elections no longer create free NPPs for parties in countries open to players, including during Founding.
tags: [elections, npps, recruitment]
badges: [hotfix]
areas: [engine]
---

- Challenger supply can reuse existing eligible regional NPPs in player countries, but cannot create free replacements or bypass normal recruitment limits.
- The empty-race Founding fallback follows the same restriction. Player presidential races do not receive NPP challengers.
- Non-player countries retain automatic challenger supply so their governments can form. Runtime country-access settings are respected.
- Normal recruitment and slate invitation processing are unchanged. No existing NPPs are deleted by this fix.
