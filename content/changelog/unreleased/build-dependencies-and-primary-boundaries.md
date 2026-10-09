---
date: 2026-10-09
title: Build reliability and primary architecture maintenance
summary: "Build jobs have more memory headroom, dependency metadata is refreshed, and primary running-mate logic has a clearer module boundary."
tags: [tooling, dependencies, elections]
badges: [patch]
areas: [backend]
---

## What changed

Build jobs have more memory headroom, dependency metadata is refreshed, and primary running-mate logic has a clearer module boundary.

## Developer detail

CI build adds swap (#3672); smol-toml moves from 1.8.0 to 1.9.0 (#3508) and source-map-js from 1.2.1 to 1.2.2 (#3504). Tentative running mates move out of primaryResolution (#3666), with architecture loop mappings corrected in #3668. Ireland seed tests pin the opening law book to its fiscal envelope (#3555). These changes do not change the player-facing release version. References: 4afe503fe0, e9f8a4cdf6, 14fde0482b, 9574dd5e79, 85a35813f0, f8cb880c23.
