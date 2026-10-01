---
date: 2026-09-25
title: Public API MCP bridge
summary: >-
  External clients can use a scoped API key to read public game data and inspect
  their key's capabilities through a local MCP bridge.
tags: [api]
badges: [minor]
areas: [backend]
---

## What changed

- Added a read-only stdio MCP bridge for the public v1 API and the caller's key
  capabilities. It uses the existing `X-API-Key` scope and rate limits.
- The API metadata now advertises MCP setup and the CDN base URL. The bridge
  keeps responses bounded and supports HTTPS deployments and local development.
