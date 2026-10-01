---
date: 2026-09-25
title: More reliable public API MCP connections
summary: >-
  The public API MCP bridge now handles malformed requests, ping health checks,
  and protocol negotiation without disconnecting or claiming unsupported versions.
tags: [api]
badges: [patch]
areas: [backend]
---

## What changed

- Validate JSON-RPC frames and tool arguments, returning protocol errors for
  malformed requests while leaving notifications unanswered.
- Answer MCP ping requests and negotiate only supported protocol versions.
- Keep the stdio bridge alive after malformed input and close cleanly if the
  client disconnects.
