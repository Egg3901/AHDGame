---
date: 2026-10-16
title: Influence tooltips, mobile nav and office allocations cleanup
summary: >-
  The profile now shows where national and party influence gains come from, the
  mobile menu puts Map up front with Economy open, and offices without laws no
  longer show an empty budget panel.
tags: [ui, profile, navigation, cabinet]
badges: [patch]
areas: [frontend, fullstack]
---

## What changed

- Profile standing: the per-turn change for actions, national influence and party influence can be tapped or hovered to list its sources (state influence, position, policy alignment, party roles, infamy, decay). Labels are underlined so the tooltips are discoverable on touch screens.
- Mobile menu: Map is a top-level link instead of living under Other, and the Economy group starts open.
- Cabinet offices with no law portfolio, such as the Chief of Staff, no longer get an Allocations tab or department budget panel.
