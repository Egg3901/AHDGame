---
date: 2026-09-25
title: Public API CDN asset catalog
summary: >-
  The public API now documents the game's static CDN. The new
  /api/public/v1/cdn endpoint returns the asset base URL, the URL pattern for
  every asset category, and curated links such as the logo, era login heroes,
  action-card art, and map GeoJSON.
tags: [api, cdn]
badges: [minor]
areas: [backend]
---

## What changed

- Added `GET /api/public/v1/cdn`, a machine-readable catalog of static CDN
  asset URL conventions and curated assets, listed in the v1 meta catalog and
  the generated OpenAPI document.
