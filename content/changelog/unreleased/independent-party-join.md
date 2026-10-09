---
date: 2026-10-09
title: Keep independent candidates in their race when joining a party
summary: "An independent candidate who joins a party stays in the race under their new party."
tags: [elections, parties]
badges: [patch]
areas: [backend]
---

## What changed

An independent candidate who joins a party stays in the race under their new party.

## Developer detail

Party-switch handling retains independent candidacies on joining a party; candidates switching between parties still follow the existing withdrawal rule. Reference: commit d828f22825.
